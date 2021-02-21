import functions = require("firebase-functions");
import admin = require("firebase-admin");
const {Client} = require("@elastic/elasticsearch");

admin.initializeApp();

const env = functions.config();
const auth = {
  username: env.elasticsearch.username,
  password: env.elasticsearch.password,
};

const client = new Client({node: env.elasticsearch.url, auth: auth});

// Add Artwork
exports.addArtwork = functions.firestore
    .document("artworks/{artworkId}")
    .onCreate(async (snap) => {
      client.index({
        index: "artworks",
        type: "_doc",
        id: snap.id,
        body: snap.data(),
      });
    });

// Update Artwork
exports.updateArtwork = functions.firestore
    .document("artworks/{artworkId}")
    .onUpdate(async (snap) => {
      await client.index({
        index: "artworks",
        type: "_doc",
        id: snap.after.id,
        body: snap.after.data(),
      });
    });

// Delete Artwork
exports.deleteArtwork= functions.firestore
    .document("artworks/{artworkId}")
    .onDelete(async (snap) => {
      await client.index({
        index: "artworks",
        type: "_doc",
        id: snap.id,
        body: snap.data(),
      });
    });
