# Use ATOM from Telegram

Telegram lets you talk to ATOM from your phone. You can answer what waits for you, read reports and steer tasks. ATOM runs on your Mac. Telegram is only the remote control.

ATOM uses its own bot. Do not use the bot of another tool. Two programs that read one bot disturb each other.

## What you need

- ATOM running on your Mac, with the Claude plan signed in.
- The Telegram app on your phone or Mac.
- Five minutes.

## Set it up

1. Open Telegram. Start a chat with `@BotFather`.
2. Send `/newbot`. Choose a name. Choose a user name that ends in `bot`.
3. BotFather sends a token. It looks like `123456789:ABC-DEF…`. Copy it. The token is the key to your bot. Keep it secret.
4. Open the chat with your new bot. Send it any message, for example `hello`. Nothing answers yet. This is normal.
5. Find your chat number. Open this address in a browser. Put your token in place of `<TOKEN>`:

   `https://api.telegram.org/bot<TOKEN>/getUpdates`

   Find `"chat":{"id":` in the text. The number after it is your chat number. It can be negative for a group. Use a private chat, not a group (see "Safety").
6. Open the file `.env` in the ATOM project folder. Add two lines:

   ```text
   ATOM_TELEGRAM_BOT_TOKEN=123456789:ABC-DEF…
   ATOM_TELEGRAM_CHAT_ID=123456789
   ```

   The file `.env` stays on your Mac. Git does not keep it.
7. Quit ATOM and open it again.
8. Open Settings → General. The Telegram row says **Connected**.
9. Send `hello` to the bot. ATOM answers.

## What you can do

Send a normal message. ATOM answers as it does in the window. Your chat in Telegram is a chat of its own, called "telegram".

| Command | What it does |
|---|---|
| `/needs` | Shows what waits for your answer, with buttons. |
| `/tasks` | Lists tasks that run or wait to run. |
| `/report 12` | Shows the report of task 12. |
| `/steer 12 use the shorter plan` | Sends a message to task 12. |
| `/interrupt 12` | Stops the current step of task 12. The task waits for your message. |
| `/help` | Shows this list. |

## Buttons

Some messages come with buttons. Press a button to answer. The button works like the same button in the ATOM window.

- **Allow** or **Decline** answers a question from ATOM, for example "Click Send in Mail".
- **Approve** or **Reject** answers a plan, a skill or a change to an agent.
- **Retry** starts a failed task again.

A button that is out of date says so. Use `/needs` to get the current ones.

## What ATOM sends by itself

ATOM sends a message when something new waits for you:

- a question from ATOM that needs your OK,
- a plan that waits for approval,
- a change to an agent that waits for a decision,
- a skill that waits for approval.

ATOM also sends the result of a routine when the routine has "Send result to Telegram" on. An agent that finishes work in this chat reports here too.

Failed tasks are not sent by themselves. They show in `/needs`.

To stop the messages that ATOM sends by itself, turn off **Send to Telegram** in Settings → General. Answers to your own messages still come.

## When the network fails

ATOM tries again. A message that fails to send is sent again after 1, 3 and 9 seconds. When Telegram asks ATOM to wait, ATOM waits. A new item that could not be sent is tried again every 30 seconds, six times at most. After that it waits in `/needs` and in the ATOM window.

A message to ATOM that takes more than ten minutes to answer is dropped. ATOM tells you. Send it again.

## Safety

- ATOM serves one chat only: the chat in `ATOM_TELEGRAM_CHAT_ID`. Messages from any other chat are ignored.
- Use a private chat with your bot. In a group, every member could press **Allow**.
- Anyone who has the token can control the bot. If the token leaks, send `/revoke` to BotFather. Then put the new token in `.env`.
- Telegram is not end-to-end encrypted. Your messages, the summaries of questions and the reports pass through Telegram. Do not use Telegram for work that must stay private.
- A button press can allow a risky action on your Mac. Read the question before you press **Allow**.
- ATOM writes no message text and no token into its log. The log holds counts, codes and command names.

## If it does not work

| What you see | What to do |
|---|---|
| Settings says **Not set up** | Check that both lines are in `.env` and spelled exactly. Restart ATOM. |
| The bot does not answer | The chat number may be wrong. Open `logs/atom.log` and look for `telegram.ignored`. A count above zero means messages come from another chat. |
| The log shows `409` | Another program reads the same bot. Give ATOM its own bot. |
| The log shows `401` | The token is wrong or revoked. Make a new one with BotFather. |
| The log shows `403` | You blocked the bot, or the chat number is wrong. |
| A button says it is out of date | Send `/needs` to get the current buttons. |
