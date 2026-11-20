@echo off
echo Generate a local ESPHome API encryption key. Keep the result private.
powershell.exe -NoLogo -NoProfile -Command "$bytes = New-Object byte[] 32; $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes); [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }"
if errorlevel 1 echo Key generation failed.
echo Copy the key into your local secrets.yaml.
pause
