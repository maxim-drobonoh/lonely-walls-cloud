import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
const createAwsElasticsearchConnector = require("aws-elasticsearch-connector");

const {Client} = require("@elastic/elasticsearch");

admin.initializeApp();

const db = admin.firestore();
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

/*
 * Exhibition
 * Chat
 */
// eslint-disable-next-line no-unused-vars
enum ExhibitionStatus { REQUESTED = "REQUESTED", ACCEPTED = "ACCEPTED"}

interface Exhibition {
    id: string
    createdAt: admin.firestore.Timestamp
    editedAt: admin.firestore.Timestamp | null
    createdBy: string
    members: string[]
    status: ExhibitionStatus
    venue: {
        venueGooglePlaceId: string
        name: string
        reviews: number
        rating: number
        type: string
        verified: boolean
        image: string | null
    }
    artist: {
        id: string
        fullName: string
        artType: string | string[]
    }
    chatRoomId: string
}

const mapExhibition = (
    uid: string,
    doc: FirebaseFirestore.DocumentData
): Exhibition => {
  return {
    id: uid,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    editedAt: doc.editedAt,
    members: doc.members,
    status: doc.status as ExhibitionStatus,
    chatRoomId: doc.chatRoomId,
    venue: doc.venue,
    artist: doc.artist,
  };
};

export type MessageType = "request" | "message" | "review" | "waiting_details"

interface Chat {
    id: string
    members: string[]
    createdById: string
    isSeen: boolean
    createdAt: admin.firestore.Timestamp
}


export interface MessagePayload {
    exhibitionId: string
    senderId: string
    artist: {
        name: string
    }
    venue: {
        name: string
    }
}

export interface IMessage {
    id: string
    type: MessageType
    createdAt: Date
    isRead: boolean
    text: string | ""
    payload: MessagePayload | null
}

const createChatRoomRef = () => {
  return db.collection("chatRoom").doc();
};

const createChatRoom = (
    chat: Omit<Chat, "createdAt">,
    chatRoomId: string
) => {
  return db.collection("chatRoom").doc(chatRoomId).set(chat);
};

// Create Exhibition
exports.createExhibition = functions.firestore
    .document("exhibitions/{exhibitionId}")
    .onCreate(async (snap) => {
      const exhibition = mapExhibition(
          snap.id,
          snap.data()
      );

      if ( exhibition.status === ExhibitionStatus.REQUESTED) {
        const chatRoomRef = createChatRoomRef();
        const chat = {
          id: chatRoomRef.id,
          createdAt: new Date(),
          members: exhibition.members,
          createdById: exhibition.createdBy,
          isSeen: false,
        };
        await createChatRoom(chat, chatRoomRef.id);
        const messagesRef = chatRoomRef.collection("messages").doc();

        const message = <IMessage>{
          id: messagesRef.id,
          type: "request",
          createdAt: new Date(),
          isRead: false,
          payload: {
            senderId: exhibition.createdBy,
            exhibitionId: exhibition.id,
            venue: {
              name: exhibition.venue.name,
            },
            artist: {
              name: exhibition.artist.fullName,
            },
          },
        };

        db.collection("chatRoom")
            .doc(chatRoomRef.id)
            .collection("messages")
            .doc(messagesRef.id)
            .set(message);

        db.collection("exhibitions").doc(snap.id).set(
            {chatRoomId: chatRoomRef.id},
            {merge: true}
        );
      }
    });

// Update Exhibition
exports.updateExhibition = functions.firestore
    .document("exhibitions/{exhibitionId}")
    .onUpdate(async (snap) => {
      const beforeExhibition = mapExhibition(
          snap.before.id,
          snap.before.data()
      );
      const afterExhibition = mapExhibition(
          snap.after.id,
          snap.after.data()
      );
      if ( beforeExhibition.status === afterExhibition.status) return;

      if (afterExhibition.status === ExhibitionStatus.ACCEPTED) {
        const chatRoomRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId);

        const messagesRef = chatRoomRef.collection("messages").doc();

        const message = <IMessage>{
          id: messagesRef.id,
          type: "waiting_details",
          createdAt: new Date(),
          isRead: false,
          payload: null,
        };

        db.collection("chatRoom")
            .doc(chatRoomRef.id)
            .collection("messages")
            .doc(messagesRef.id)
            .set(message);
      }
    });

