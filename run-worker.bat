@echo off
cd /d E:\OpsMesh
call npm run dev:worker > worker.out.log 2>&1
