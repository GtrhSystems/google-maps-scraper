@echo off
REM Abre la interfaz web en http://localhost:8080.
REM Corre dentro de WSL (Ubuntu): en Windows 11 el programa nativo falla al abrir el navegador.
cd /d "%~dp0"
wsl -d Ubuntu -u root -- test -x /opt/gmaps/gmaps || wsl -d Ubuntu -u root --cd "%~dp0" -- bash wsl/instalar.sh
start "" http://localhost:8080
wsl -d Ubuntu -u root -- bash -c "cd /opt/gmaps && ./gmaps -web -addr 0.0.0.0:8080 -data-folder /opt/gmaps/webdata"
