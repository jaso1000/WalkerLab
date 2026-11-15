; WalkerLab Server - Windows installer (NSIS 3). Built by
; scripts/build-windows-installer.sh, which stages:
;   ${STAGE}\app\               backend (dist\, node_modules\, package.json) + public\ (Expo web export)
;   ${STAGE}\node\node.exe      bundled Node runtime - nothing needs to be preinstalled
;   ${STAGE}\WalkerLabService.exe   WinSW service wrapper
;   ${STAGE}\LICENSE
;
; Layout on the target machine:
;   C:\Program Files\WalkerLab Server\   program files, replaced wholesale on upgrade
;   C:\ProgramData\WalkerLab\            encrypted store + key + logs - never touched by
;                                        upgrades, kept on uninstall unless the user opts in
;
; The data dir is locked to SYSTEM + Administrators: the server writes its key/store
; with Unix mode 0600, which Windows ignores, so the ACL is what actually protects them.
;
; Silent install:   WalkerLab-Server-Setup-x.y.z.exe /S [/PORT=3000] [/D=C:\path]   (/D must be last)
; Silent uninstall: uninstall.exe /S [/PURGE]   (/PURGE also deletes the data dir)

Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !error "Pass -DVERSION=x.y.z"
!endif
!ifndef STAGE
  !error "Pass -DSTAGE=<staging dir>"
!endif
!ifndef OUTFILE
  !error "Pass -DOUTFILE=<installer path>"
!endif

!define APPNAME "WalkerLab Server"
!define SERVICE_ID "WalkerLab"
!define REGKEY "Software\WalkerLab Server"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\WalkerLabServer"
!define FWRULE "WalkerLab Server"
!define DEFAULT_PORT "3000"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\WalkerLab Server"
InstallDirRegKey HKLM "${REGKEY}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ManifestDPIAware true
BrandingText "WalkerLab ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "CompanyName" "WalkerLab"
VIAddVersionKey "LegalCopyright" "MIT License"

!ifdef ICON
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
!endif
!define MUI_ABORTWARNING

Var Port
Var PortField
Var DataDir
Var PrevInstallDir

!define MUI_WELCOMEPAGE_TEXT "This will install ${APPNAME} ${VERSION} as a Windows service.$\r$\n$\r$\nWalkerLab's web app and API run on this machine and talk to your Sonarr, Radarr, download clients and other services directly, so install it somewhere on the same network as them.$\r$\n$\r$\nIf ${APPNAME} is already installed it will be upgraded in place - your accounts and saved service settings are kept."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
Page custom PortPage PortPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open WalkerLab in your browser"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenBrowser
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} requires 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  SetShellVarContext all
  SetRegView 64
  StrCpy $DataDir "$APPDATA\WalkerLab"  ; $APPDATA = C:\ProgramData under SetShellVarContext all
  ReadRegStr $PrevInstallDir HKLM "${REGKEY}" "InstallDir"

  ; Upgrades keep the previously chosen port unless /PORT= overrides it.
  ReadRegStr $Port HKLM "${REGKEY}" "Port"
  ${If} $Port == ""
    StrCpy $Port "${DEFAULT_PORT}"
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/PORT=" $R1
  ${IfNot} ${Errors}
    StrCpy $Port $R1
  ${EndIf}
  Call ValidatePort
  Pop $R0
  ${If} $R0 != "ok"
    MessageBox MB_ICONSTOP "Invalid port '$Port' - use a number from 1 to 65535." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
FunctionEnd

; Normalizes $Port to a plain integer; pushes "ok" or "bad".
Function ValidatePort
  IntOp $R9 $Port + 0
  ${If} $R9 < 1
  ${OrIf} $R9 > 65535
  ${OrIf} "$R9" != "$Port"
    Push "bad"
  ${Else}
    StrCpy $Port $R9
    Push "ok"
  ${EndIf}
FunctionEnd

Function PortPage
  !insertmacro MUI_HEADER_TEXT "Network port" "Choose the port ${APPNAME} listens on."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 48u "WalkerLab's web app and API are served over plain HTTP on this TCP port. A Windows Firewall rule will allow it from your local subnet only.$\r$\n$\r$\nFor HTTPS or access from outside your network, put a reverse proxy or tunnel in front of it."
  Pop $0
  ${NSD_CreateLabel} 0 58u 30u 12u "Port:"
  Pop $0
  ${NSD_CreateNumber} 32u 56u 50u 13u "$Port"
  Pop $PortField
  nsDialogs::Show
FunctionEnd

Function PortPageLeave
  ${NSD_GetText} $PortField $Port
  Call ValidatePort
  Pop $0
  ${If} $0 != "ok"
    MessageBox MB_ICONEXCLAMATION "Enter a port number from 1 to 65535."
    Abort
  ${EndIf}
FunctionEnd

Function OpenBrowser
  ExecShell "open" "http://localhost:$Port/"
FunctionEnd

; ---------------------------------------------------------------------------
Section "Install"
  SetShellVarContext all
  SetRegView 64

  ; Upgrade: stop the running service before its files are replaced -
  ; `stopwait`, not `stop`, which returns while node.exe still holds its
  ; files open (the CI upgrade test caught exactly that). If the
  ; previous install lived in a different folder, unregister that service too
  ; so it can be re-registered pointing at the new location below.
  ${If} $PrevInstallDir != ""
  ${AndIf} ${FileExists} "$PrevInstallDir\WalkerLabService.exe"
    DetailPrint "Stopping the existing ${APPNAME} service..."
    nsExec::ExecToLog '"$PrevInstallDir\WalkerLabService.exe" stopwait'
    Pop $0
    ${If} $PrevInstallDir != $INSTDIR
      nsExec::ExecToLog '"$PrevInstallDir\WalkerLabService.exe" uninstall'
      Pop $0
    ${EndIf}
  ${EndIf}

  ; Replace program files wholesale so stale web bundles/deps never linger.
  ; Only ever removes our own subfolders, and only if this is our install.
  ${If} ${FileExists} "$INSTDIR\WalkerLabService.exe"
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\node"
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"

  ; Data dir: created before the service first runs, then locked to SYSTEM
  ; (the service account) + Administrators, so the key/store it creates
  ; inherit that. SIDs rather than names so this works on any OS language.
  ; Set on the folder only - no /T. Windows propagates the folder's
  ; inheritable entries down to existing files itself; /T instead stamps the
  ; folder-style (OI)(CI) entries directly onto each file, which on an
  ; upgrade left the existing key/store/logs unreadable even to SYSTEM and
  ; the restarted service died before it could log anything.
  CreateDirectory "$DataDir\logs"
  DetailPrint "Restricting $DataDir to SYSTEM and Administrators..."
  nsExec::ExecToLog 'icacls "$DataDir" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Couldn't restrict permissions on $DataDir (icacls exit code $0). Check that folder's permissions manually - it holds WalkerLab's encryption key." /SD IDOK
  ${EndIf}

  ; WinSW reads this next to WalkerLabService.exe every time the service starts.
  FileOpen $0 "$INSTDIR\WalkerLabService.xml" w
  FileWrite $0 '<service>$\r$\n'
  FileWrite $0 '  <id>${SERVICE_ID}</id>$\r$\n'
  FileWrite $0 '  <name>${APPNAME}</name>$\r$\n'
  FileWrite $0 '  <description>WalkerLab self-hosted web app and API (port $Port).</description>$\r$\n'
  FileWrite $0 '  <executable>$INSTDIR\node\node.exe</executable>$\r$\n'
  FileWrite $0 '  <arguments>"$INSTDIR\app\dist\index.js"</arguments>$\r$\n'
  FileWrite $0 '  <workingdirectory>$INSTDIR\app</workingdirectory>$\r$\n'
  FileWrite $0 '  <env name="PORT" value="$Port"/>$\r$\n'
  FileWrite $0 '  <env name="WALKERLAB_DATA_DIR" value="$DataDir"/>$\r$\n'
  FileWrite $0 '  <env name="WALKERLAB_PUBLIC_DIR" value="$INSTDIR\app\public"/>$\r$\n'
  FileWrite $0 '  <startmode>Automatic</startmode>$\r$\n'
  FileWrite $0 '  <onfailure action="restart" delay="10 sec"/>$\r$\n'
  FileWrite $0 '  <onfailure action="restart" delay="30 sec"/>$\r$\n'
  FileWrite $0 '  <resetfailure>1 hour</resetfailure>$\r$\n'
  FileWrite $0 '  <stoptimeout>15 sec</stoptimeout>$\r$\n'
  FileWrite $0 '  <logpath>$DataDir\logs</logpath>$\r$\n'
  FileWrite $0 '  <log mode="roll-by-size">$\r$\n'
  FileWrite $0 '    <sizeThreshold>10240</sizeThreshold>$\r$\n'
  FileWrite $0 '    <keepFiles>5</keepFiles>$\r$\n'
  FileWrite $0 '  </log>$\r$\n'
  FileWrite $0 '</service>$\r$\n'
  FileClose $0

  ; Register the service only if it isn't already (sc query exits 1060 when missing).
  nsExec::Exec 'sc.exe query ${SERVICE_ID}'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Registering the ${APPNAME} service..."
    nsExec::ExecToLog '"$INSTDIR\WalkerLabService.exe" install'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "Couldn't register the ${APPNAME} Windows service (exit code $0)." /SD IDOK
      SetErrorLevel 3
      Abort
    ${EndIf}
  ${EndIf}

  DetailPrint "Adding Windows Firewall rule for TCP $Port (local subnet)..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${FWRULE}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FWRULE}" dir=in action=allow protocol=TCP localport=$Port remoteip=localsubnet profile=any'
  Pop $0

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${REGKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "Port" "$Port"
  WriteRegStr HKLM "${REGKEY}" "Version" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "WalkerLab"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINSTKEY}" "EstimatedSize" "$0"

  CreateDirectory "$SMPROGRAMS\WalkerLab Server"
  WriteINIStr "$SMPROGRAMS\WalkerLab Server\Open WalkerLab.url" "InternetShortcut" "URL" "http://localhost:$Port/"
  CreateShortcut "$SMPROGRAMS\WalkerLab Server\Uninstall WalkerLab Server.lnk" "$INSTDIR\uninstall.exe"

  DetailPrint "Starting the ${APPNAME} service..."
  nsExec::ExecToLog '"$INSTDIR\WalkerLabService.exe" start'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "${APPNAME} was installed but the service didn't start (exit code $0). Check the logs in $DataDir\logs - another program may already be using port $Port." /SD IDOK
    SetErrorLevel 4
  ${EndIf}
SectionEnd

; ---------------------------------------------------------------------------
Function un.onInit
  SetShellVarContext all
  SetRegView 64
  StrCpy $DataDir "$APPDATA\WalkerLab"  ; $APPDATA = C:\ProgramData under SetShellVarContext all
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64

  DetailPrint "Stopping and removing the ${APPNAME} service..."
  nsExec::ExecToLog '"$INSTDIR\WalkerLabService.exe" stopwait'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\WalkerLabService.exe" uninstall'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${FWRULE}"'
  Pop $0
  Sleep 1000

  ; Explicit paths only - never RMDir /r $INSTDIR itself, in case someone
  ; installed into a folder that also holds other things.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  Delete "$INSTDIR\WalkerLabService.exe"
  Delete "$INSTDIR\WalkerLabService.xml"
  Delete "$INSTDIR\WalkerLabService.*.log"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  RMDir /r "$SMPROGRAMS\WalkerLab Server"
  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey HKLM "${REGKEY}"

  ${un.GetParameters} $R0
  ClearErrors
  ${un.GetOptions} $R0 "/PURGE" $R1
  ${IfNot} ${Errors}
    RMDir /r "$DataDir"
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete WalkerLab's data in $DataDir?$\r$\n$\r$\nThis permanently deletes every user account and saved service setting, and can't be undone. Choose No to keep it for a future reinstall." /SD IDNO IDNO keepData
      RMDir /r "$DataDir"
    keepData:
  ${EndIf}
SectionEnd
