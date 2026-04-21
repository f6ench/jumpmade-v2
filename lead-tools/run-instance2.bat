@echo off
set SCRAPE_TELEGRAM_TOKEN=8728524493:AAEtj_HaCrAShxd-597Gk7zraoo8ocksst0
set SCRAPE_TELEGRAM_CHAT_ID=7718747703
cd /d C:\scraper
node scrape-all-trades.js --fast --concurrent 2 --instance 2 --start-from Insulation --stop-at Stonemason > logs\scrape-all.log 2>&1
