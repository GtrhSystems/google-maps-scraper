@echo off
REM Abre la interfaz web en http://127.0.0.1:8080 (descarga el programa la primera vez).
cd /d "%~dp0"
if not exist gmaps.exe (
  curl.exe -L -o gmaps.exe https://github.com/gosom/google-maps-scraper/releases/download/v1.18.1/google_maps_scraper-1.18.1-windows-amd64.exe
)
start "" http://127.0.0.1:8080
gmaps.exe -web -addr 127.0.0.1:8080 -data-folder webdata
