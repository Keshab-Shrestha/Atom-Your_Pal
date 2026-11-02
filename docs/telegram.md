# Use ARK from Telegram

Telegram lets you talk to ARK from your phone. You can answer what waits for you, read reports and steer tasks. ARK runs on your Mac. Telegram is only the remote control.

ARK uses its own bot. Do not use the bot of another tool. Two programs that read one bot disturb each other.

## What you need

- ARK running on your Mac, with the Claude plan signed in.
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
6. Open the file `.env` in the ARK project folder. Add two lines:

   ```text
   ARK_TELEGRAM_BOT_TOKEN=123456789:ABC-DEF…
   ARK_TELEGRAM_CHAT_ID=123456789
   ```

   The file `.env` stays on your Mac. Git does not keep it.
7. Quit ARK and open it again.
8. Open Settings → General. The Telegram row says **Connected**.
9. Send `hello` to the bot. ARK answers.

## What you can do

Send a normal message. ARK answers as it does in the window. Your chat in Telegram is a chat of its own, called "telegram".

| Command | What it does |
|---|---|
| `/needs` | Shows what waits for your answer, with buttons. |
| `/tasks` | Lists tasks that run or wait to run. |
| `/report 12` | Shows the report of task 12. |
| `/steer 12 use the shorter plan` | Sends a message to task 12. |
| `/help` or `/start` | Shows this list. |

## Buttons

Some messages come with buttons. Press a button to answer. The button works like the same button in the ARK window.

- **Allow** or **Decline** answers a question from ARK, for example "Click Send in Mail".
- **Approve** or **Reject** answers a plan, a skill or a change to an agent.
- **Retry** starts a failed task again.

A button that is out of date says so. Use `/needs` to get the current ones.

## What ARK sends by itself

ARK sends a message when something new waits for you:

- a question from ARK that needs your OK,
- a plan that waits for approval,
- a change to an agent that waits for a decision,
- a skill that waits for approval.

ARK also sends the result of a routine when the routine has "Send result to Telegram" on. An agent that finishes work in this chat reports here too.

Failed tasks are not sent by themselves. They show in `/needs`.

A task that is running cannot be interrupted by step. Send `/steer` to give it a message, or stop it in the ARK window.

To stop the messages that ARK sends by itself, turn off **Send to Telegram** in Settings → General. Answers to your own messages still come.

## When ARK was closed

ARK does not run messages that arrived while it was closed. A command or a button press that is hours old could do the wrong thing. When ARK starts, it skips them and sends you one message with the count. Send again what still matters.

## When the network fails

ARK tries again. A message that fails to send is sent again after 1, 3 and 9 seconds. When Telegram asks ARK to wait, ARK waits. A new item that could not be sent is tried again every 30 seconds, six tries in all (the first one included). After that it waits in `/needs` and in the ARK window.

An answer, a command reply or a routine result that could not be sent waits and is tried again every 30 seconds, in order, six tries in all. A long message that failed partway is sent again from the part that failed, so no part arrives twice.

If the token is wrong or was revoked (the log shows `telegram.token_rejected`), or another program reads the same bot (`telegram.conflict`), ARK waits five minutes between tries and does not hammer Telegram. Fix the cause (a new token, or a bot of its own) and restart ARK.

A message to ARK that takes more than ten minutes to answer is dropped. ARK tells you. Send it again.

## Safety

- ARK serves one chat only: the chat in `ARK_TELEGRAM_CHAT_ID`. Messages from any other chat are ignored.
- ARK also checks **who sent** each message and each button press. In a private chat with your bot the sender is you, so nothing more is needed. Anyone else in the same chat is ignored.
- A group is possible only if you add one more line to `.env`: `ARK_TELEGRAM_USER_ID=<your own user number>`. Then ARK obeys you alone in that group. Without this line, ARK obeys nobody in a group. A private chat is still the better choice.
- Anyone who has the token can control the bot. If the token leaks, send `/revoke` to BotFather. Then put the new token in `.env`.
- Telegram is not end-to-end encrypted. Your messages, the summaries of questions and the reports pass through Telegram. Do not use Telegram for work that must stay private.
- A button press can allow a risky action on your Mac. Read the question before you press **Allow**.
- ARK writes no message text and no token into its log. The log holds counts, codes and command names.

## If it does not work

| What you see | What to do |
|---|---|
| Settings says **Not set up** | Check that both lines are in `.env` and spelled exactly. Restart ARK. |
| The bot does not answer | The chat number may be wrong. Open `logs/ark.log` and look for `telegram.ignored`. A count above zero means messages come from another chat. |
| The log shows `409` | Another program reads the same bot. Give ARK its own bot. |
| The log shows `401` | The token is wrong or revoked. Make a new one with BotFather. |
| The log shows `403` | You blocked the bot, or the chat number is wrong. |
| A button says it is out of date | Send `/needs` to get the current buttons. |
