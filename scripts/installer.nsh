!macro BroadcastEnvironmentChange
  System::Call 'USER32::SendMessageTimeoutW(i ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, i 0, w "Environment", i 2, i 5000, *i .r0)'
!macroend

!macro customInstall
  WriteRegExpandStr HKCU "Environment" "NOVA_CLI" "$INSTDIR\NOVA-CLI.exe"
  !insertmacro BroadcastEnvironmentChange
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Environment" "NOVA_CLI"
  StrCmp $0 "$INSTDIR\NOVA-CLI.exe" 0 +2
  DeleteRegValue HKCU "Environment" "NOVA_CLI"
  !insertmacro BroadcastEnvironmentChange
!macroend
