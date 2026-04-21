#!/bin/bash
# Auto-start enrichment when plumber scrape finishes
LOG="C:/Users/josep/OscarVault/Jumpmade/checkatrade-sniper/lead-tools/scrape-plumber.log"
OUTPUT="C:/Users/josep/OscarVault/Jumpmade/checkatrade-sniper/lead-tools/output/all-uk-plumbers.csv"
ENRICH="C:/Users/josep/OscarVault/Jumpmade/checkatrade-sniper/lead-tools/enrich-leads.js"

echo "Waiting for plumber scrape to finish..."

while true; do
    if grep -q "Scraping Complete" "$LOG" 2>/dev/null; then
        echo "Scrape complete! Found output:"
        wc -l "$OUTPUT"
        echo "Starting enrichment..."
        cd "C:/Users/josep/OscarVault/Jumpmade/checkatrade-sniper/lead-tools"
        export CH_API_KEY="aa5649ec-60cd-4644-9580-6ac533ef2c40"
        node "$ENRICH" "$OUTPUT" "./output/enriched-plumbers.csv" > enrich-plumber.log 2>&1
        echo "Enrichment finished. Check enrich-plumber.log"
        exit 0
    fi
    sleep 60
done
