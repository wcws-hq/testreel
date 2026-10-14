# Uploading to YouTube

Uploading is optional. Without it Testreel still makes the videos, thumbnails, titles and descriptions, and you can upload the files by hand. To get the Upload button working you need your own Google OAuth client. Testreel ships none, so nobody else can post to your channel.

## 1. Create the OAuth client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. Go to **APIs and Services, Library**, search for **YouTube Data API v3** and click **Enable**.
3. Go to **APIs and Services, OAuth consent screen**. Choose **External**, fill in the app name and your email, and save.
4. On the same screen add your own Google account under **Test users**.
5. Go to **APIs and Services, Credentials, Create credentials, OAuth client ID**. Choose **Desktop app** as the type.
6. Copy the **client ID** and **client secret** into `.env`:

```
YT_CLIENT_ID=...apps.googleusercontent.com
YT_CLIENT_SECRET=...
```

Restart `bun run start`.

## 2. Connect your channel

Open a finished run, scroll to **Upload to YouTube** and click **Connect**. Google asks you to sign in and allow two permissions: upload videos, and manage your YouTube account (used to read the channel name and set thumbnails). Testreel listens on a random local port on `127.0.0.1` for the redirect and stops listening as soon as you are signed in.

The refresh token is stored in `~/.testreel/.youtube/main.json` with file mode 600. Nothing else is stored. **Disconnect** deletes the file.

## 3. Upload

Each video has its own card with a privacy choice (Private, Unlisted, Public) and an optional scheduled publish time. Private is the default. The optional "Upload automatically when ready" switch on the home page always uploads as private.

Uploads are marked as containing synthetic media, because the voice is AI generated, and the description says so.

## Things that surprise people

- **Refresh tokens expire after 7 days while the consent screen is in Testing.** This is Google's rule for external apps in testing. When it happens the card asks you to connect again. Publishing the consent screen removes the 7 day limit, though Google then shows an "unverified app" warning for you.
- **New API projects may only upload private videos.** Google's API policy locks videos uploaded through the API to private for projects that have not passed an API compliance audit. If your uploads stay private even when you pick Public, that is why. You can change the privacy in YouTube Studio after the upload, or apply for the audit.
- **Quota.** The default quota is 10,000 units a day and one upload costs 1,600, so about 6 uploads a day. New channels also have a daily upload limit and may need phone verification.
- **"Google returned no refresh token."** Remove Testreel at <https://myaccount.google.com/permissions> and connect again.
