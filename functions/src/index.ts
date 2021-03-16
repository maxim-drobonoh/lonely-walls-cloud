import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
const createAwsElasticsearchConnector = require("aws-elasticsearch-connector");

const {Client} = require("@elastic/elasticsearch");

admin.initializeApp();

const AWS = require("aws-sdk");
const env = functions.config();
const AWS_REGION = "eu-central-1";

AWS.config.region = AWS_REGION;

AWS.config.update({
  credentials: new AWS.Credentials(
      env.elasticsearch.keyid,
      env.elasticsearch.secretkey
  ),
  region: AWS_REGION,
});

const client = new Client({
  ...createAwsElasticsearchConnector(AWS.config),
  node: env.elasticsearch.url,
});

interface Dimensions {
    height: number,
    width: number,
    thickness: number
}

interface Artwork {
    id: string,
    key: string
    category: string,
    title: string,
    userName: string,
    userId: string,
    description: string,
    dimensions: Dimensions | null,
    edition: string,
    images: [],
    orientation: string,
    status: string,
    keywords: string[],
    materials: string[]
    styles: [],
    year: string,
    price: 100,
    frame: boolean,
    shopify: Shopify
}

interface Shopify {
    productId: number
    variantsId: number[]
}

interface ElasticQuery {
    collection: any,
    query: any
}

const mapArtwork = (
    uid: string,
    doc: FirebaseFirestore.DocumentData
): Artwork => {
  return {
    id: uid,
    key: doc.key,
    category: doc.category,
    title: doc.title,
    userName: doc.userName,
    userId: doc.userId,
    description: doc.description,
    dimensions: doc.dimensions,
    edition: doc.edition,
    images: doc.images,
    orientation: doc.orientation,
    status: doc.status,
    styles: doc.styles || [],
    keywords: doc.keywords || [],
    materials: doc.materials || [],
    year: doc.year,
    price: doc.price,
    frame: doc.frame,
    shopify: doc.shopify,
  };
};


// Add Artwork
exports.addArtwork = functions.firestore
    .document("artworks/{artworkId}")
    .onCreate(async (snap) => {
      client.index({
        index: "artworks",
        type: "_doc",
        id: snap.id,
        body: mapArtwork(snap.id, snap.data()),
      });
    });

// Update Artwork
exports.updateArtwork = functions.firestore
    .document("artworks/{artworkId}")
    .onUpdate(async (snap) => {
      const {after}= snap;
      await client.index({
        index: "artworks",
        type: "_doc",
        id: after.id,
        body: mapArtwork(after.id, after.data()),
      });
    });

// Delete Artwork
exports.deleteArtwork= functions.firestore
    .document("artworks/{artworkId}")
    .onDelete(async (snap) => {
      await client.delete({
        index: "artworks",
        type: "_doc",
        id: snap.id,
      });
    });

// ElasticsSearch proxy
exports.elasticQuery = functions.https.onCall(async (query: ElasticQuery) => {
  const {body, statusCode} = await client.search({
    index: query.collection,
    body: query.query,
  });
  console.log(body);

  return {
    body, statusCode,
  };
});
