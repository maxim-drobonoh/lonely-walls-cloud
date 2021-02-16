import functions = require("firebase-functions");
import admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

exports.onArtworkCreate = functions.firestore.document("artworks/{artworkId}")
    .onCreate((snap) => {
      const artworkId = snap.id;
      const artwork = snap.data();

      if ( !artwork.title || !artwork.userName || !artwork.category) return;

      const searchKeywords = generateKeywords(artwork.title)
          .concat(generateKeywords(artwork.userName))
          .concat(generateKeywords(artwork.category));

      const indexArtwork = {...artwork, searchKeywords: searchKeywords};

      return db.collection("artworks")
          .doc(artworkId)
          .set(indexArtwork, {merge: true});
    });

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
