# Use ATOM from your phone

The phone page shows what waits for you and your tasks. You can approve a plan, retry a failed task, read a report and send a goal. ATOM runs on your Mac. The phone is only a remote control.

The page reaches your Mac through Tailscale. Tailscale makes a private network between your own devices. ATOM opens no port on your Wi-Fi and none on the internet.

## What you need

- ATOM running on your Mac, with the **Local API** switch on (Settings → General).
- A free Tailscale account.
- The Tailscale app on the Mac and on the phone, signed in to the same account.
- Ten minutes.

## Set it up

1. Install Tailscale on the Mac and on the phone. Sign in to the same account on both.
2. Open the Tailscale admin page in a browser. Open **DNS**. Turn on **HTTPS Certificates**.
3. Find the name of your Mac. It looks like `keshabs-mini.tail1234.ts.net`. The Tailscale app on the Mac shows it.
4. In ATOM, open Settings → General → Local API. Press **Copy command**. Run the command in the Terminal. It is `tailscale serve --bg 4790`. Run it once.
5. Open the file `.env` in the ATOM project folder. Add one line. Put your name in place of the example:

   ```text
   ATOM_API_HOST=keshabs-mini.tail1234.ts.net
   ```

6. Quit ATOM and open it again.
7. On the phone, open `https://keshabs-mini.tail1234.ts.net/app`.
8. In ATOM, press **Copy token** (Settings → General → Local API). Send the token to the phone in a way you trust, for example a password manager. Paste it into the page. Press **Connect**.

The page keeps the token on that phone. Press **Sign out** on the page to remove it.

## What you can do

- **Needs you:** the cards that wait for your answer. A plan has **Approve** and **Reject**. A failed task has **Retry**.
- **Cards the phone cannot answer:** a click, a command, a new agent, a change to an agent and a skill. The page says "Answer this one on the Mac or on Telegram". This rule protects you (ADR-120).
- **New goal:** write what ATOM must do and press **Send**. ATOM reads it and gives it to an agent. The answer shows on the page.
- **Tasks:** your newest tasks. Tap a task to read its report.

The page refreshes every 15 seconds.

## Safety

- Only devices in your own Tailscale account can reach the page. Do not use **Tailscale Funnel**. Funnel opens the page to the whole internet.
- The token is the key. Anyone who has the token and is in your tailnet can approve plans and send goals. If a phone is lost, press **Regenerate** in Settings → General → Local API. Every phone stops working until you paste the new token.
- ATOM checks the name in each request. A request with another name gets an error. This stops a web page from reaching ATOM through your browser.
- After ten wrong tokens in one minute, ATOM refuses all data requests for one minute.
- ATOM writes no token, no task text and no report into its log.

## If it does not work

| What you see | What to do |
|---|---|
| The page does not open | Check that Tailscale runs on both devices. Run `tailscale serve status` on the Mac. It must show port 4790. |
| "This address is not allowed" | `ATOM_API_HOST` does not match the name in the address. Copy the name again. Restart ATOM. |
| The page says the token is wrong | You pressed Regenerate. Copy the new token. |
| "Too many wrong tokens" | Wait one minute. Then paste the token again. |
| The Local API switch is off | Turn it on in Settings → General. |
