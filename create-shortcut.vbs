Set oWS = CreateObject("WScript.Shell")
Set oFS = CreateObject("Scripting.FileSystemObject")

strBatFile = "D:\inventory-management-system\啟動應用.bat"
strDesktop = oWS.SpecialFolders("Desktop")
strShortcut = strDesktop & "\Inventory System.lnk"

If Not oFS.FileExists(strBatFile) Then
    MsgBox "Error: Startup file not found", vbCritical, "Failed"
    WScript.Quit 1
End If

Set oLink = oWS.CreateShortcut(strShortcut)
oLink.TargetPath = strBatFile
oLink.WorkingDirectory = "D:\inventory-management-system"
oLink.Description = "Inventory Management System"
oLink.IconLocation = "C:\Windows\System32\cmd.exe,0"
oLink.Save

MsgBox "Success! Shortcut created on desktop.", vbInformation, "Done"
