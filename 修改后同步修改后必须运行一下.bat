@echo off
title VCPChat Sync Tool 3.1
cd /d "%~dp0"
git config --global core.quotepath false
echo [1/4] Staging changes...
git add .
echo [2/4] Committing local updates...
git commit -m "chore: auto sync update %date% %time%"
echo [3/4] Pulling and Merging...
git pull origin main --no-edit
echo [4/4] Pushing to GitHub...
git push origin main
echo [Done] All systems aligned.
pause