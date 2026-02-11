#!/bin/bash

echo "========================================"
echo "File Organization Script"
echo "NO FILES WILL BE DELETED - Only Moved"
echo "========================================"
echo ""

# Create new folders
echo "Creating folders..."
mkdir -p docs
mkdir -p scripts
mkdir -p archive/migrations
mkdir -p archive/old-schemas
mkdir -p archive/old-versions
echo "✓ Folders created"
echo ""

# Move documentation files
echo "Moving documentation..."
mv *.md docs/ 2>/dev/null || true
echo "✓ Documentation moved to docs/"
echo ""

# Move development/testing scripts
echo "Moving development tools..."
mv check-*.js scripts/ 2>/dev/null || true
mv verify-*.js scripts/ 2>/dev/null || true
mv test-*.js scripts/ 2>/dev/null || true
echo "✓ Development tools moved to scripts/"
echo ""

# Move migration scripts (already used)
echo "Moving migration scripts..."
mv create-*.js archive/migrations/ 2>/dev/null || true
mv fix-*.js archive/migrations/ 2>/dev/null || true
mv setup-database.js archive/migrations/ 2>/dev/null || true
mv run-db-updates.js archive/migrations/ 2>/dev/null || true
echo "✓ Migration scripts moved to archive/migrations/"
echo ""

# Move old SQL schemas
echo "Moving old SQL schemas..."
mv database-updates-phase1.sql archive/old-schemas/ 2>/dev/null || true
mv database-upgrade.sql archive/old-schemas/ 2>/dev/null || true
mv database-salary-module.sql archive/old-schemas/ 2>/dev/null || true
mv setup_database.sql archive/old-schemas/ 2>/dev/null || true
mv add-settings-table.sql archive/old-schemas/ 2>/dev/null || true
echo "✓ Old schemas moved to archive/old-schemas/"
echo ""

# Move backup/old HTML files
echo "Moving backup files..."
mv public/*-backup.html archive/old-versions/ 2>/dev/null || true
mv public/*-old.html archive/old-versions/ 2>/dev/null || true
mv public/*-v2.html archive/old-versions/ 2>/dev/null || true
mv public/*-v3.js archive/old-versions/ 2>/dev/null || true
mv public/test-*.html archive/old-versions/ 2>/dev/null || true
mv public/header-loader.js archive/old-versions/ 2>/dev/null || true
mv register.html archive/old-versions/ 2>/dev/null || true
echo "✓ Backup files moved to archive/old-versions/"
echo ""

# Keep working schema in root, move complete schema to docs
echo "Moving schemas..."
mv database-complete-schema.sql docs/ 2>/dev/null || true
echo "✓ Complete schema moved to docs/"
echo "  (database-working-schema.sql stays in root)"
echo ""

echo "========================================"
echo "Organization Complete!"
echo "========================================"
echo ""
echo "Folder Structure:"
echo "├── docs/              (Documentation)"
echo "├── scripts/           (Dev tools)"
echo "├── archive/"
echo "│   ├── migrations/    (Old migration scripts)"
echo "│   ├── old-schemas/   (Old SQL files)"
echo "│   └── old-versions/  (Backup HTML/JS files)"
echo ""
echo "✓ All files preserved - Nothing deleted!"
echo ""
