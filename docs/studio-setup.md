# Studio setup (ADR-267)

Studio makes short vertical videos and posts them to YouTube. You approve each video and each post on an Allow card. ARK never sees your passwords. You put the keys in ARK's `.env` file yourself.

## 1. Footage: a Gemini API key

1. Open Google AI Studio and sign in.
2. Make an API key.
3. Turn on billing for the key's project. Video costs money: about $0.07 for each second of video at 720p. A 30-second Short costs about $2.
4. Open `~/Developer/atom/.env` in a text editor.
5. Add this line: `ARK_STUDIO_GEMINI_KEY=<your key>`
6. Save the file.

Note: Google shut down Veo in the Gemini API on 22 October 2026. Studio uses the replacement, Gemini Omni Flash, with the same key.

## 2. Video editing: ffmpeg

1. Run `brew install ffmpeg` if it is not installed.

Note: the current ffmpeg build has no text filter. Studio cannot burn captions into the video. Studio writes a caption file (`.srt`) next to each video.

## 3. YouTube: a Google sign-in client

1. Open Google Cloud Console and make a project.
2. Turn on "YouTube Data API v3" for the project.
3. Set up the OAuth consent screen. Set the user type to External. Add your own Google account as a test user.
4. Make an OAuth client ID. Set the type to "Desktop app".
5. Add these two lines to `.env`:
   - `ARK_YOUTUBE_CLIENT_ID=<client id>`
   - `ARK_YOUTUBE_CLIENT_SECRET=<client secret>`
6. Restart ARK.
7. Open Plugins > Studio. Click "Sign in to YouTube". Sign in to your channel in the browser. Close the tab when the page tells you to.

Note: Google may keep uploads private until it verifies your app. If a post comes back private, make it public in YouTube Studio.

## 4. Use it

1. In a chat, write: "Make a 30-second video about today's AI news and post it to YouTube."
2. Read the first Allow card. It shows the estimated cost. Click Allow to make the video.
3. Read the second Allow card. It shows the title, the description and the privacy. Click Allow to post it.

The videos stay in the Studio folder. Open it from Plugins > Studio > Open folder.
