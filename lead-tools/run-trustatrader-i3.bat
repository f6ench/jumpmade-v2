@echo off
set SCRAPE_TELEGRAM_TOKEN=8728524493:AAEtj_HaCrAShxd-597Gk7zraoo8ocksst0
set SCRAPE_TELEGRAM_CHAT_ID=7718747703
set PROXY_FILE=C:\scraper\proxies-fast.txt
cd /d C:\scraper
"C:\Program Files\nodejs\node.exe" scrape-all-trustatrader.js --skip-existing --instance 3 --of 3 > C:\scraper\logs\trustatrader-i3.log 2>&1
