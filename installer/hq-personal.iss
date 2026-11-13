; HQ Personal Edition: Windows setup program (Inno Setup 6.7+).
; Built by scripts/build-release.ps1 from dist\HQ (the same files as the zip):
;   ISCC.exe /DAppVersion=1.1.0 installer\hq-personal.iss  ->  dist\HQ-Personal-Setup-1.1.0.exe
;
; Installs for the current user only: no admin rights, no UAC prompt, no service, nothing that starts
; with Windows. It copies the files, makes the Start-menu (and optional Desktop) shortcut and registers
; the uninstaller in Settings > Apps. HQ itself runs with the bundled, OpenJS-signed node.exe.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\HQ"
#endif
#define AppName "HQ Personal Edition"
#define NodeExe "{app}\runtime\node\node.exe"
#define Launcher "{app}\app\launcher.mjs"

[Setup]
AppId={{EF8A7E57-A9EC-489E-8492-32CD2427D3DD}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=thefhiter
AppPublisherURL=https://github.com/thefhiter/hq-personal
AppSupportURL=https://github.com/thefhiter/hq-personal
AppCopyright=© 2026 thefhiter
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
VersionInfoCompany=thefhiter
PrivilegesRequired=lowest
DefaultDirName={autopf}\HQ
DisableDirPage=auto
DisableProgramGroupPage=yes
DisableWelcomePage=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=HQ-Personal-Setup-{#AppVersion}
SetupIconFile=..\public\assets\hq.ico
UninstallDisplayIcon={app}\app\public\assets\hq.ico
UninstallDisplayName={#AppName}
WizardStyle=modern dynamic
; the same (dark) art in light and dark mode; without the DynamicDark lines dark mode shows Inno's own pictures
WizardImageFile=art\side-164x314.png,art\side-246x471.png,art\side-328x628.png
WizardImageFileDynamicDark=art\side-164x314.png,art\side-246x471.png,art\side-328x628.png
WizardSmallImageFile=art\small-55x55.png,art\small-83x83.png,art\small-110x110.png
WizardSmallImageFileDynamicDark=art\small-55x55.png,art\small-83x83.png,art\small-110x110.png
Compression=lzma2/max
SolidCompression=yes
SetupLogging=yes
; HQ is stopped by PrepareToInstall below; Restart Manager stays on as the fallback
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "ar"; MessagesFile: "compiler:Languages\Arabic.isl"

[CustomMessages]
en.OpenHQ=Open HQ now
fr.OpenHQ=Ouvrir HQ maintenant
ar.OpenHQ=افتح HQ الآن
en.Comment=Your command center: focus room, music, AI, projects and notes
fr.Comment=Votre centre de commande : concentration, musique, IA, projets et notes
ar.Comment=مركز القيادة الخاص بك: التركيز، الموسيقى، الذكاء الاصطناعي، المشاريع والملاحظات
en.DeleteData=Also delete your HQ data?%n%nThis removes your settings, API keys, chats, notes, music and backgrounds from this PC (%1).%n%nChoose No to keep them for a later install.
fr.DeleteData=Supprimer aussi vos données HQ ?%n%nCela efface vos réglages, clés API, discussions, notes, musiques et fonds d'écran de ce PC (%1).%n%nChoisissez Non pour les garder pour une prochaine installation.
ar.DeleteData=هل تريد حذف بيانات HQ أيضاً؟%n%nسيؤدي ذلك إلى حذف إعداداتك ومفاتيح API والمحادثات والملاحظات والموسيقى والخلفيات من هذا الحاسوب (%1).%n%nاختر «لا» للاحتفاظ بها لتثبيت لاحق.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; a clean copy every time (your data lives in %LOCALAPPDATA%\HQ, never here)
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
; HQ 1.0.0 (retired script installer) copied itself straight into this folder and made shortcuts that
; start a .vbs file: remove all of it so nothing broken is left behind
Type: filesandordirs; Name: "{app}\node_modules"; Check: HadLegacyHQ
Type: filesandordirs; Name: "{app}\public"; Check: HadLegacyHQ
Type: filesandordirs; Name: "{app}\scripts"; Check: HadLegacyHQ
Type: filesandordirs; Name: "{app}\server"; Check: HadLegacyHQ
Type: files; Name: "{app}\LICENSE"; Check: HadLegacyHQ
Type: files; Name: "{app}\package.json"; Check: HadLegacyHQ
Type: files; Name: "{app}\README.md"; Check: HadLegacyHQ
Type: files; Name: "{autodesktop}\HQ.lnk"; Check: HadLegacyHQ
Type: filesandordirs; Name: "{autoprograms}\HQ"; Check: HadLegacyHQ

[Files]
Source: "{#SourceDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; named "HQ" here; HQ renames them to the app name its owner picks (and keeps the list for the uninstaller).
; Never "runminimized": Chrome/Edge then open HQ's window minimized too, and it looks like nothing happened.
Name: "{autoprograms}\HQ"; Filename: "{#NodeExe}"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\public\assets\hq.ico"; Comment: "{cm:Comment}"
Name: "{autodesktop}\HQ"; Filename: "{#NodeExe}"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\public\assets\hq.ico"; Comment: "{cm:Comment}"; Tasks: desktopicon

[Run]
Filename: "{#NodeExe}"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; Description: "{cm:OpenHQ}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{#NodeExe}"; Parameters: """{#Launcher}"" --stop"; WorkingDir: "{app}\app"; Flags: runhidden waituntilterminated; RunOnceId: "StopHQ"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
Type: dirifempty; Name: "{app}"

[Code]
const
  DataFolder = '{localappdata}\HQ';

var
  LegacyHQ: Boolean;

{ HQ 1.0.0 lives directly in the install folder (package.json + server\ at the top, no uninstaller). }
function HadLegacyHQ: Boolean;
begin
  Result := LegacyHQ;
end;

{ Closes a running HQ so its files can be replaced (an update, or a repair). }
procedure StopHQ;
var
  Code: Integer;
begin
  if FileExists(ExpandConstant('{#NodeExe}')) and FileExists(ExpandConstant('{#Launcher}')) then
    Exec(ExpandConstant('{#NodeExe}'), AddQuotes(ExpandConstant('{#Launcher}')) + ' --stop',
      ExpandConstant('{app}\app'), SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { decided once, before [InstallDelete] starts removing the files it looks at }
  LegacyHQ := FileExists(ExpandConstant('{app}\package.json')) and DirExists(ExpandConstant('{app}\server'));
  if LegacyHQ then
    Log('Found HQ 1.0.0 files in the install folder: they will be removed');
  StopHQ;
  Result := '';
end;

{ HQ renames its shortcuts after the app name its owner picks; it lists them in shortcuts.txt. }
procedure RemoveOwnerShortcuts;
var
  Lines: TArrayOfString;
  I: Integer;
  F: String;
begin
  if not LoadStringsFromFile(ExpandConstant(DataFolder + '\shortcuts.txt'), Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    F := Trim(Lines[I]);
    if (F <> '') and (CompareText(ExtractFileExt(F), '.lnk') = 0) and FileExists(F) then
      DeleteFile(F);
  end;
  DeleteFile(ExpandConstant(DataFolder + '\shortcuts.txt'));
  DeleteFile(ExpandConstant(DataFolder + '\shortcuts.json'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usUninstall then
    RemoveOwnerShortcuts;
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant(DataFolder);
    if DirExists(Data) and not UninstallSilent then
      if MsgBox(FmtMessage(CustomMessage('DeleteData'), [Data]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
