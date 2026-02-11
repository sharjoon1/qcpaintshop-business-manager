@echo off
echo ========================================
echo File Organization Script
echo NO FILES WILL BE DELETED - Only Moved
echo ========================================
echo.

REM Create new folders
echo Creating folders...
mkdir docs 2>nul
mkdir scripts 2>nul
mkdir archive 2>nul
mkdir archive\migrations 2>nul
mkdir archive\old-schemas 2>nul
mkdir archive\old-versions 2>nul
echo ✓ Folders created
echo.

REM Move documentation files
echo Moving documentation...
move *.md docs\ 2>nul
echo ✓ Documentation moved to docs\
echo.

REM Move development/testing scripts
echo Moving development tools...
move check-*.js scripts\ 2>nul
move verify-*.js scripts\ 2>nul
move test-*.js scripts\ 2>nul
echo ✓ Development tools moved to scripts\
echo.

REM Move migration scripts (already used)
echo Moving migration scripts...
move create-*.js archive\migrations\ 2>nul
move fix-*.js archive\migrations\ 2>nul
move setup-database.js archive\migrations\ 2>nul
move run-db-updates.js archive\migrations\ 2>nul
echo ✓ Migration scripts moved to archive\migrations\
echo.

REM Move old SQL schemas
echo Moving old SQL schemas...
move database-updates-phase1.sql archive\old-schemas\ 2>nul
move database-upgrade.sql archive\old-schemas\ 2>nul
move database-salary-module.sql archive\old-schemas\ 2>nul
move setup_database.sql archive\old-schemas\ 2>nul
move add-settings-table.sql archive\old-schemas\ 2>nul
echo ✓ Old schemas moved to archive\old-schemas\
echo.

REM Move backup/old HTML files
echo Moving backup files...
move public\*-backup.html archive\old-versions\ 2>nul
move public\*-old.html archive\old-versions\ 2>nul
move public\*-v2.html archive\old-versions\ 2>nul
move public\*-v3.js archive\old-versions\ 2>nul
move public\test-*.html archive\old-versions\ 2>nul
move public\header-loader.js archive\old-versions\ 2>nul
move register.html archive\old-versions\ 2>nul
echo ✓ Backup files moved to archive\old-versions\
echo.

REM Keep working schema in root, move complete schema to docs
echo Moving schemas...
move database-complete-schema.sql docs\ 2>nul
echo ✓ Complete schema moved to docs\
echo   (database-working-schema.sql stays in root)
echo.

echo ========================================
echo Organization Complete!
echo ========================================
echo.
echo Folder Structure:
echo ├── docs\              (Documentation)
echo ├── scripts\           (Dev tools)
echo ├── archive\
echo │   ├── migrations\    (Old migration scripts)
echo │   ├── old-schemas\   (Old SQL files)
echo │   └── old-versions\  (Backup HTML/JS files)
echo.
echo ✓ All files preserved - Nothing deleted!
echo.
pause
