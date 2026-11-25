# BTC MACD 5m Telegram Alerts — GitHub Actions free-tier edition

This is a separate GitHub repository from the backtesting website. It does not place orders.

## Setup on iPhone

1. Create a **new public GitHub repository** (public repositories use GitHub-hosted standard runners without Actions-minute billing, subject to GitHub usage policy). Do not upload the ZIP itself: unzip it and upload all files, including the hidden `.github/workflows/btc-macd-alert.yml` path. GitHub's web UI may not preserve nested paths when uploading from iPhone; alternatively create `.github/workflows/btc-macd-alert.yml` using **Add file > Create new file**, and upload the remaining three files in the root.
2. Create a Telegram bot through @BotFather and save its token **privately**.
3. Send `/start` to your new bot. To find the chat ID, visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` privately in your browser after sending a message to your bot; locate `message.chat.id`. Never paste the token, chat ID, or URL containing token into public GitHub, this chat, screenshots, or issue comments.
4. GitHub repository > **Settings > Secrets and variables > Actions > New repository secret**. Create `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
5. GitHub repository > **Actions** > enable workflows if prompted. Select **BTC MACD 5m Telegram Alert** > **Run workflow** for a test. A manual run only sends a message if a fresh closed candle also meets the strategy, so no message is normal. Review the workflow log for errors.
6. GitHub Actions scheduled workflows only run on the default branch. Keep the repository active; GitHub may disable schedules after 60 days of no activity on a public repository.

## Strategy

- Binance BTCUSDT spot 5m candles; 12/26/9 EMA MACD, histogram `2*(DIF-DEA)`.
- LONG when DIF and DEA are both >0 and histogram slope flips from decreasing to increasing (`hist[i-1]<hist[i-2] && hist[i]>hist[i-1]`). SHORT symmetric when DIF and DEA are both <0.
- The MACD conditions trigger the alert. The most recent confirmed swing low (LONG) or high (SHORT) supplies an optional stop and 5R target when it is on the correct side of the reference close.
- Message includes signal candle close as **reference**, not a guaranteed next-bar entry, and an indicative 5R target when a valid stop exists. This scanner does not track open positions.

## Reliability limitations

GitHub Actions cron runs are **not real-time or guaranteed**. Schedules can be delayed or dropped, especially near busy times. Runs occur around UTC minutes 1,6,11,...; the scanner only processes the latest closed candle when it is less than 2 minutes old, so late runs **skip** rather than send stale signals. One run every 5 minutes; duplicate prevention uses a per-slot GitHub Actions cache marker, which is best-effort and not a transactional database. Network/API errors, GitHub downtime, disabled schedules and Telegram outages can result in missed alerts. Monitor the Actions log periodically. For trading-critical notifications use a persistent worker with a durable database and alerting for failures.

**Security:** do not commit tokens, use repository Actions secrets only. No automated trades are executed.
