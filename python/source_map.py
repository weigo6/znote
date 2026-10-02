"""Block provenance adapter for the pinned Python-Markdown parser.

Positions are carried through preprocessing and scoped parser recursion, never
recovered from rendered text. Untrackable extension output is explicitly inherited
or generated. No global monkey patches; one adapter belongs to one Markdown instance.
"""
import bisect
import difflib
import re
from html.parser import HTMLParser
from dataclasses import dataclass
from types import MethodType

from markdown.treeprocessors import Treeprocessor
from markdown import util

ATTRIBUTE = "data-zn-node"
BLOCK_TAGS = {"p", "pre", "blockquote", "ul", "ol", "li", "table", "tr",
              "h1", "h2", "h3", "h4", "h5", "h6", "div", "details", "summary", "hr"}
PLACEHOLDER = re.compile(util.HTML_PLACEHOLDER % r"(\d+)")
ATTRIBUTES = re.compile(r'''\s+(?P<name>[^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?''')
PREFIX = re.compile(r"^(?:(?:>\s*)|(?:[-*+]\s+)|(?:\d+[.)]\s+))+")


def clean_reserved(html):
    """Remove owned attributes without modifying text or other quoted values."""
    if ATTRIBUTE not in html.lower():
        return html
    starts = [0]
    for match in re.finditer("\n", html):
        starts.append(match.end())
    patches = []

    class Cleaner(HTMLParser):
        def handle_starttag(self, tag, attrs):
            raw = self.get_starttag_text()
            line, column = self.getpos()
            base = starts[line - 1] + column
            for match in ATTRIBUTES.finditer(raw):
                if match.group("name").lower() == ATTRIBUTE:
                    patches.append((base + match.start(), base + match.end()))

        handle_startendtag = handle_starttag

    parser = Cleaner(convert_charrefs=False)
    parser.feed(html)
    parser.close()
    for start, end in reversed(patches):
        html = html[:start] + html[end:]
    return html


@dataclass(frozen=True)
class Origin:
    start: int
    end: int
    precision: str = "exact"


def canonical(line):
    # List/quote processors remove these prefixes before recursive parsing.
    return PREFIX.sub("", line.strip()).strip()


class Chunk(str):
    def __new__(cls, text, origins):
        value = super().__new__(cls, text)
        value.token = object()
        value.origins = origins
        value.keys = [canonical(line) for line in text.split("\n")]
        value.index = {}
        value._span = False
        for i, key in enumerate(value.keys):
            if key:
                value.index.setdefault(key, []).append(i)
        return value

    def part(self, text, cursor=0):
        keys = [canonical(line) for line in text.split("\n")]
        significant = [(i, key) for i, key in enumerate(keys) if key]
        if not significant:
            return Chunk(text, [None] * len(keys)), cursor
        first, key = significant[0]
        positions = self.index.get(key, [])
        at = bisect.bisect_left(positions, cursor)
        # Extension-transformed chunks may not match. Keep failed alignment
        # bounded even in a giant list of repeated text.
        for position_index in range(at, min(len(positions), at + 16)):
            candidate = positions[position_index]
            start = candidate - first
            if start < 0 or start + len(keys) > len(self.keys):
                continue
            if all(self.keys[start + i] == key for i, key in significant):
                return Chunk(text, self.origins[start:start + len(keys)]), start + len(keys)
        origin = self.range("inherited")
        return Chunk(text, [origin] * len(keys)), cursor

    def range(self, precision=None):
        if self._span is not False:
            origin = self._span
            return Origin(origin.start, origin.end, precision) if origin and precision else origin
        origins = [origin for i, origin in enumerate(self.origins)
                   if origin is not None and i < len(self.keys) and self.keys[i]]
        if not origins:
            self._span = None
            return None
        self._span = Origin(min(x.start for x in origins), max(x.end for x in origins),
                            "exact" if all(x.precision == "exact" for x in origins) else "inherited")
        return Origin(self._span.start, self._span.end, precision) if precision else self._span


class SourceMap(Treeprocessor):
    def __init__(self, md, text):
        super().__init__(md)
        self.nodes = {}
        self.entries = []
        self.active = None
        self.in_document = False
        self.cursors = {}
        self.stashes = {}
        offset = 0
        self.origins = []
        for line in text.split("\n"):
            end = offset + len(line.encode("utf-16-le")) // 2
            self.origins.append(Origin(offset, end))
            offset = end + 1
        self.install()

    def install(self):
        for preprocessor in self.md.preprocessors:
            original = preprocessor.run

            normalizer = preprocessor.__class__.__name__ == "NormalizeWhitespace"

            def run(lines, original=original, normalizer=normalizer):
                result = original(lines)
                if normalizer:
                    self.origins = self.origins[:len(result)] + [None] * max(0, len(result) - len(self.origins))
                else:
                    self.remap(lines, result)
                return result

            preprocessor.run = run
        parser = self.md.parser
        original_document = parser.parseDocument

        def document(parser, lines):
            self.document_chunk = Chunk("\n".join(lines), self.origins)
            self.in_document = True
            try:
                return original_document(lines)
            finally:
                self.in_document = False

        def chunk(parser, parent, text):
            located = self.locate(parent, text)
            pieces = []
            cursor = 0
            for piece in str(located).split("\n\n"):
                count = piece.count("\n") + 1
                pieces.append(Chunk(piece, located.origins[cursor:cursor + count]))
                cursor += count + 1
            parser.parseBlocks(parent, pieces)

        def blocks(parser, parent, values):
            # This loop mirrors the public BlockParser.parseBlocks contract.
            while values:
                current = values[0] = self.locate(parent, values[0])
                previous_active = self.active
                self.active = current
                span = current.range()
                if parent.tag in BLOCK_TAGS and span:
                    self.merge(parent, span)
                for match in PLACEHOLDER.finditer(current):
                    if span:
                        self.stashes[int(match.group(1))] = span
                try:
                    for processor in parser.blockprocessors:
                        if not processor.test(parent, current):
                            continue
                        size = len(parent)
                        last = parent[-1] if size else None
                        last_state = (len(last), last.text, last[-1].text if len(last) else None) if last is not None else None
                        if processor.run(parent, values) is False:
                            continue
                        for index in range(size, len(parent)):
                            node = parent[index]
                            if node in self.nodes:
                                continue
                            specific = span
                            if node.tag.startswith("h") and node.tag[1:] in "123456" and node.text:
                                # Header processors may split a multi-block chunk.
                                match = getattr(processor, "RE", None)
                                match = match.search(current) if match else None
                                if match:
                                    a = str(current)[:match.start()].count("\n")
                                    if match.start() < len(current) and current[match.start()] == "\n":
                                        a += 1
                                    b = str(current)[:match.end()].rstrip("\n").count("\n") + 1
                                    specific = Chunk("\n".join(str(current).split("\n")[a:b]), current.origins[a:b]).range()
                            if specific and node.tag in BLOCK_TAGS:
                                self.merge(node, specific)
                        changed = last is not None and last_state != (len(last), last.text, last[-1].text if len(last) else None)
                        if changed and last.tag in {"ul", "ol", "blockquote", "pre"} and span:
                            self.merge(last, span)
                        # A processor can push transformed remainders back onto the queue.
                        if values and not isinstance(values[0], Chunk):
                            values[0], _ = current.part(values[0])
                        break
                finally:
                    self.active = previous_active

        parser.parseDocument = MethodType(document, parser)
        parser.parseChunk = MethodType(chunk, parser)
        parser.parseBlocks = MethodType(blocks, parser)
        self.md.treeprocessors.register(self, "znote_source_map", -100)

    def locate(self, parent, text):
        if isinstance(text, Chunk):
            return text
        scope = self.active or (getattr(self, "document_chunk", None) if self.in_document else None)
        if scope is None:
            return Chunk(text, [None] * (text.count("\n") + 1))
        if str(scope) == text:
            return scope
        key = scope.token
        located, cursor = scope.part(text, self.cursors.get(key, 0))
        self.cursors[key] = cursor
        return located

    def merge(self, node, origin):
        previous = self.nodes.get(node)
        if previous:
            origin = Origin(min(previous.start, origin.start), max(previous.end, origin.end),
                            "exact" if previous.precision == origin.precision == "exact" else "inherited")
        self.nodes[node] = origin

    def remap(self, before, after):
        if before == after:
            return
        origins = [None] * len(after)
        # autojunk bounds repeated-line preprocessing cost; ambiguous changed
        # regions become inherited, rather than fabricated exact positions.
        matcher = difflib.SequenceMatcher(None, before, after, autojunk=True)
        for operation, a, b, c, d in matcher.get_opcodes():
            if operation == "equal":
                origins[c:d] = self.origins[a:b]
            elif operation == "replace":
                old = [x for x in self.origins[a:b] if x]
                if old:
                    nonempty = [i for i in range(c, d) if after[i].strip()]
                    collapsed = len(nonempty) == 1 and PLACEHOLDER.search(after[nonempty[0]])
                    span = Origin(min(x.start for x in old), max(x.end for x in old),
                                  "exact" if collapsed and all(x.precision == "exact" for x in old) else "inherited")
                    for i in range(c, d):
                        origins[i] = span
        self.origins = origins

    def entry(self, origin, kind, parent=None):
        node_id = str(len(self.entries))
        item = {"id": node_id, "kind": kind, "precision": origin.precision if origin else "generated"}
        if origin:
            item.update({"from": origin.start, "to": origin.end})
        if parent is not None:
            item["parentId"] = parent
        self.entries.append(item)
        return node_id

    def run(self, root):
        def visit(node, inherited=None, parent=None):
            # Reserved mapping attributes are renderer-owned, including raw HTML.
            node.attrib.pop(ATTRIBUTE, None)
            origin = self.nodes.get(node)
            if origin is None and inherited:
                origin = Origin(inherited.start, inherited.end, "inherited")
            placeholder = PLACEHOLDER.fullmatch((node.text or "").strip())
            if node.tag in BLOCK_TAGS and not placeholder:
                parent = node.attrib[ATTRIBUTE] = self.entry(origin, node.tag, parent)
            for child in node:
                visit(child, origin, parent)
        for child in root:
            visit(child)
        for i, html in enumerate(self.md.htmlStash.rawHtmlBlocks):
            if not isinstance(html, str):
                continue
            html = clean_reserved(html)
            match = re.match(r"\s*<([a-zA-Z][\w-]*)(?=[\s>])", html)
            if match and match.group(1).lower() in BLOCK_TAGS:
                node_id = self.entry(self.stashes.get(i), match.group(1).lower())
                html = html[:match.end()] + f' {ATTRIBUTE}="{node_id}"' + html[match.end():]
            self.md.htmlStash.rawHtmlBlocks[i] = html

