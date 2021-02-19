import functions = require("firebase-functions");
import admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

interface Artwork {
    id: string,
    key: string
    category: string,
    title: string,
    userName: string,
    userId: string,
    description: string,
    dimensions: [],
    edition: string,
    images: [],
    orientation: string,
    status: string,
    styles: [],
    year: string,
    price: 100,
    frame: boolean,
    keywords: string[]
}

const mapArtwork = (
    uid: string,
    doc: FirebaseFirestore.DocumentData
): Artwork => ({
  id: uid,
  category: doc.category,
  title: doc.title,
  userName: doc.userName,
  userId: doc.userId,
  description: doc.description,
  dimensions: doc.dimensions,
  edition: doc.edition,
  images: doc.images,
  key: doc.key,
  orientation: doc.orientation,
  status: doc.status,
  styles: doc.styles,
  year: doc.year,
  price: doc.price,
  frame: doc.frame,
  keywords: [],
});

exports.onArtworkDelete = functions.firestore
    .document("artworks/{artworkId}")
    .onDelete(async (snapshot) => {
      const deletedArtworkId = snapshot.id;
      const artwork = mapArtwork(deletedArtworkId, snapshot.data());

      const usersRef = await db.collection("users_artworks")
          .doc(artwork.userId).get();

      if (!usersRef.exists) return;

      const artworksGroup = usersRef.data();
      if (!artworksGroup) return;

      const artworks : Artwork[] = [];

      // @ts-ignore
      artworksGroup.artworks.forEach((item) => {
        const artwork = mapArtwork(item.id, item);
        if (artwork.id !== deletedArtworkId) {
          artworks.push(artwork);
        }
      });

      return aggregateArtworks(
          artworks.length > 0 ? artworks[0].price : 0,
          artwork.userId,
          artwork.userName,
          artworks
      );
    });

exports.aggregateArtworksByUser = functions.firestore
    .document("artworks/{artworkId}")
    .onWrite(async (event) => {
      const artworkSnap = event.after.data();
      if (!artworkSnap) return;

      const artworks : Artwork[] = [];
      const newArtwork = mapArtwork(event.after.id, artworkSnap);
      const userId = newArtwork.userId;

      const artworksSnapshot = await db.collection("artworks")
          .where("userId", "==", userId)
          .get();

      artworksSnapshot.forEach((item) => {
        functions.logger.log("item", item);

        const artwork = mapArtwork(item.id, item);
        artworks.push(artwork);
      });

      return aggregateArtworks(
          newArtwork.price,
          newArtwork.userId,
          newArtwork.userName,
          artworks
      );
    });

const aggregateArtworks = async (
    price: number,
    userId : string,
    userName: string,
    artworks:Artwork[] ) => {
  let framed: boolean = false;
  const filters: string[] = [];

  let minPrice = price;
  let maxPrice = price;

  const searchKeywords: Set<String> = new Set<string>();

  artworks.forEach((artwork: Artwork) => {
    if (artwork.price < minPrice) {
      minPrice = artwork.price;
    }
    if (artwork.price > maxPrice) {
      maxPrice = artwork.price;
    }
    if (artwork.frame) {
      framed = true;
    }

    filters.push(artwork.orientation);
    artwork.styles.forEach((style) => {
      filters.push(style);
    });

    const keywords = generateKeywords(artwork.userName)
        .concat(generateKeywords(artwork.title));
    keywords.forEach((keyword) => {
      searchKeywords.add(keyword);
    });
    artwork.keywords = Array.from(keywords);
  });

  return await db.collection("users_artworks")
      .doc(userId)
      .set({
        username: userName,
        artworks: artworks,
        price: {
          min: minPrice,
          max: maxPrice,
        },
        hasFrame: framed,
        filters: filters,
        searchKeywords: Array.from(searchKeywords),
      },
      {merge: true});
};

const generateKeywords = (fieldValue: string) => {
  const wordArr = fieldValue.toLowerCase().split(" ");
  const searchableKeywords = [fieldValue];

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
