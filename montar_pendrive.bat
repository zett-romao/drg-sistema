@echo off
chcp 65001 >nul 2>&1
title DRG-Kronos 3.0 — Montar Distribuicao
cls

echo.
echo  ========================================================
echo    DRG-Kronos 3.0 — Montar Pasta de Distribuicao
echo  ========================================================
echo.

set "SRC=%~dp0"
set "DEST=%~dp0_pendrive"

echo  Pasta de destino: %DEST%
echo.

:: Limpar pasta anterior
if exist "%DEST%" (
  echo  Limpando pasta anterior...
  rmdir /s /q "%DEST%"
)
mkdir "%DEST%"
echo  OK — Pasta _pendrive criada.

:: ---- Copiar arquivos do sistema ----
echo.
echo  Copiando arquivos do sistema...
copy "%SRC%index.html"          "%DEST%\" >nul && echo    index.html          OK
copy "%SRC%app.js"              "%DEST%\" >nul && echo    app.js              OK
copy "%SRC%styles.css"          "%DEST%\" >nul && echo    styles.css          OK
copy "%SRC%ponto.html"          "%DEST%\" >nul && echo    ponto.html          OK
copy "%SRC%ponto-sw.js"         "%DEST%\" >nul && echo    ponto-sw.js         OK
copy "%SRC%ponto-manifest.json" "%DEST%\" >nul && echo    ponto-manifest.json OK
if exist "%SRC%logo.png" (copy "%SRC%logo.png" "%DEST%\" >nul && echo    logo.png            OK)
if exist "%SRC%logo.svg" (copy "%SRC%logo.svg" "%DEST%\" >nul && echo    logo.svg            OK)

:: ---- Copiar firebase-config como template (sem credenciais reais) ----
echo.
echo  Copiando firebase-config.js (template sem credenciais)...
copy "%SRC%firebase-config.template.js" "%DEST%\firebase-config.js" >nul
echo    firebase-config.js   OK (template — precisa preencher!)

:: ---- Copiar manual de implantacao ----
echo.
if exist "%SRC%manual_implantacao.html" (
  copy "%SRC%manual_implantacao.html" "%DEST%\" >nul
  echo    manual_implantacao.html  OK
) else (
  echo    AVISO: manual_implantacao.html nao encontrado — ignorado.
)

:: ---- Criar ABRIR.bat dentro de _pendrive ----
echo.
echo  Criando ABRIR.bat...
(
  echo @echo off
  echo title DRG-Kronos 3.0
  echo echo.
  echo echo  =======================================
  echo echo    DRG-Kronos 3.0 — Iniciando sistema
  echo echo  =======================================
  echo echo.
  echo echo  Abrindo no navegador padrao...
  echo start "" "%%~dp0index.html"
  echo echo.
  echo echo  Se o sistema nao abrir, verifique se o
  echo echo  arquivo firebase-config.js foi configurado.
  echo echo  Consulte o Manual de Implantacao.
  echo timeout /t 4 /nobreak ^>nul
) > "%DEST%\ABRIR.bat"
echo    ABRIR.bat            OK

:: ---- Resultado ----
echo.
echo  ========================================================
echo    CONCLUIDO!
echo.
echo    Pasta _pendrive pronta com os seguintes arquivos:
echo  ========================================================
dir /b "%DEST%"
echo.
echo  PROXIMOS PASSOS:
echo    1. Abra firebase-config.js em um editor de texto
echo    2. Substitua os valores "COLE_AQUI_..." pelas
echo       credenciais do Firebase do cliente
echo    3. Copie a pasta _pendrive para o pen drive
echo    4. No computador do cliente: clique duplo em ABRIR.bat
echo.
echo  IMPORTANTE: Cada cliente precisa de um projeto Firebase
echo  proprio. Nao reutilize as credenciais entre clientes!
echo.
pause
