; Register supported types without writing extension defaults or UserChoice.
; SHELL_CONTEXT follows the installer's current-user / per-machine install mode.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown" "" "Markdown document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown" "FriendlyTypeName" "Markdown document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ZNote.Markdown" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "ZNote.Markdown" ""

  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".md" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".markdown" ""

  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationDescription" "Local Markdown editor and reader"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" ".md" "ZNote.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" ".markdown" "ZNote.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "ZNote" "Software\ZNote\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ZNote.Markdown"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "ZNote.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ZNote.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "ZNote"
  DeleteRegKey SHELL_CONTEXT "Software\ZNote\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
