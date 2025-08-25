const express = require("express");
const axios = require("axios");
const cors = require("cors");
const querystring = require("querystring");
require("dotenv").config();

const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);


app.get("/google/login", (req, res) => {
  const scopes = ["https://www.googleapis.com/auth/youtube"];
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });
  res.redirect(url);
});

app.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    global.googleTokens = tokens;

    const frontendUrl = "http://localhost:5173"; 
    res.redirect(`${frontendUrl}/?signedIn=true`);
  } catch (err) {
    console.error("Google Auth error:", err.message);
    res.redirect("http://localhost:5173/?signedIn=false");
  }
});


app.post("/convert", async (req, res) => {
  try {
    const { spotifyUrl, youtubePlaylistName } = req.body;

    const playlistId = spotifyUrl.split("playlist/")[1].split("?")[0];

    const spotifyTokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({ grant_type: "client_credentials" }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64"),
        },
      }
    );
    const spotifyToken = spotifyTokenRes.data.access_token;

    const tracksRes = await axios.get(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      {
        headers: { Authorization: "Bearer " + spotifyToken },
      }
    );

    const tracks = tracksRes.data.items.map((item) => {
      const track = item.track;
      return `${track.name} ${track.artists[0].name}`;
    });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const playlistResponse = await youtube.playlists.insert({
      part: ["snippet,status"],
      requestBody: {
        snippet: { title: youtubePlaylistName, description: "Converted from Spotify" },
        status: { privacyStatus: "private" },
      },
    });

    const youtubePlaylistId = playlistResponse.data.id;

    for (let song of tracks) {
      const searchRes = await youtube.search.list({
        part: "snippet",
        q: song,
        maxResults: 1,
        type: "video",
      });

      if (searchRes.data.items.length > 0) {
        const videoId = searchRes.data.items[0].id.videoId;

        await youtube.playlistItems.insert({
          part: "snippet",
          requestBody: {
            snippet: {
              playlistId: youtubePlaylistId,
              resourceId: { kind: "youtube#video", videoId },
            },
          },
        });
      }
    }

    res.json({ message: "Playlist created successfully!", youtubePlaylistId });
  } catch (err) {
  console.error("Error converting playlist:", err.response?.data || err.message || err);
  res.status(500).json({ error: "Failed to convert playlist" });
}
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
