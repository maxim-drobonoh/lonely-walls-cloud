import functions = require("firebase-functions");
import admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

interface Artwork {
    category: string,
    title: string,
    userName: string,
}

const mapArtwork = (doc: FirebaseFirestore.DocumentData): Artwork => ({
  category: doc.category,
  title: doc.title,
  userName: doc.userName,
});

exports.onArtworkCreate = functions.firestore
    .document("artworks/{artworkId}")
    .onCreate((snap) => {
      return addArtworkSearchKeywords(
          snap.id,
          mapArtwork(snap.data())
      );
    });

exports.onArtworkUpdate = functions.firestore
    .document("artworks/{artworkId}")
    .onUpdate(((change) => {
      return addArtworkSearchKeywords(
          change.after.id,
          mapArtwork(change.after.data())
      );
    }));

const addArtworkSearchKeywords = (artworkId: string, artwork: Artwork) => {
  if (!artwork.title || !artwork.userName || !artwork.category) return;

  const searchKeywords = generateKeywords(artwork.title)
      .concat(generateKeywords(artwork.userName))
      .concat(generateKeywords(artwork.category));

  const indexArtwork = {...artwork, searchKeywords: searchKeywords};

  return db.collection("artworks")
      .doc(artworkId)
      .set(indexArtwork, {merge: true});
};

const generateKeywords = (fieldValue: string) => {
  const wordArr = fieldValue.toLowerCase().split(" ");
  const searchableKeywords = [];

  let prevKey = "";
  for (const word of wordArr) {
    const charArr = word.toLowerCase().split("");
    for (const char of charArr) {
      const keyword = prevKey + char;
      searchableKeywords.push(keyword);
      prevKey = keyword;
    }
    prevKey = "";
  }
  return searchableKeywords;
};
