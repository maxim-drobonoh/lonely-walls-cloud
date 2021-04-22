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
enum ExhibitionStatus {
    REQUESTED = "REQUESTED",
    ACCEPTED = "ACCEPTED",
    REVIEW = "REVIEW",
    DETAILS_ACCEPTED = "DETAILS_ACCEPTED",
    DETAILS_CHANGED = "DETAILS_CHANGED",
    OPEN = "OPEN",
    CLOSED = "CLOSED",
    DECLINED = "DECLINED",
    CANCELED = "CANCELED"
}

interface Exhibition {
    id: string
    title: string | null
    createdAt: Date
    editedAt: Date | null
    editedBy?: string | null
    startDate: Date | null
    endDate: Date | null
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
    artworks: Artwork[]
}

const mapExhibition = (
    uid: string,
    doc: FirebaseFirestore.DocumentData
): Exhibition => {
  return {
    id: uid,
    title: doc.title || null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    editedBy: doc.editedBy || null,
    startDate: doc.startDate || null,
    endDate: doc.endDate || null,
    editedAt: doc.editedAt || null,
    members: doc.members,
    status: doc.status as ExhibitionStatus,
    chatRoomId: doc.chatRoomId,
    venue: doc.venue,
    artist: doc.artist,
    artworks: doc.artworks || [],
  };
};

export type MessageType = "message" | "action"

export type MessageStatus =
    | "requested"
    | "request_accepted"
    | "request_declined"
    | "request_canceled"
    | "request_waiting_approve"
    | "waiting_review"
    | "check_details"
    | "waiting_details"
    | "details_accepted"
    | "waiting_opening"
    | "open"
    | "closed"
    | "details_changed"
    | "view_exhibition"

interface Chat {
    id: string
    members: string[]
    createdById: string
    isSeen: boolean
    createdAt: admin.firestore.Timestamp
}

export interface ExhibitionDetails {
    title: string
    startDate: Date
    endDate: Date,
    artworksCount: number
}

export interface MessagePayload {
    senderStatus: MessageStatus
    receiverStatus: MessageStatus,
    exhibitionDetails: ExhibitionDetails
}

export interface IMessage {
    id: string
    type: MessageType
    senderId: string
    createdAt: Date
    isRead: boolean
    text: string | ""
    payload: MessagePayload
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
exports.onCreateExhibition = functions.firestore
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
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: exhibition.createdBy,
          payload: {
            senderStatus: "requested",
            receiverStatus: "request_waiting_approve",
            exhibitionDetails: {
              title: exhibition.title,
              startDate: exhibition.startDate,
              endDate: exhibition.endDate,
              artworksCount: exhibition.artworks.length,
            },
          } as MessagePayload,
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
exports.onUpdateExhibition = functions.firestore
    .document("exhibitions/{exhibitionId}")
    .onUpdate(async (snap) => {
      const afterExhibition = mapExhibition(
          snap.after.id,
          snap.after.data()
      );

      const generateMessageId = (chatRoomId: string) => db
          .collection("chatRoom")
          .doc(chatRoomId).collection("messages")
          .doc();

      const sendMessage = (msg: IMessage) => {
        const chatId = afterExhibition.chatRoomId;
        const chatRoomRef = db.collection("chatRoom").doc(chatId);

        return db.collection("chatRoom")
            .doc(chatRoomRef.id)
            .collection("messages")
            .doc(msg.id)
            .set(msg);
      };

      if (afterExhibition.status === ExhibitionStatus.ACCEPTED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {
                receiverStatus: "request_accepted",
                senderStatus: "request_accepted",
                exhibitionDetails: {
                  title: afterExhibition.title,
                  startDate: afterExhibition.startDate,
                  endDate: afterExhibition.endDate,
                  artworksCount: afterExhibition.artworks.length,
                },
              }},
              {merge: true}
          );
        });

        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: afterExhibition.createdBy,
          payload: {
            senderStatus: "waiting_details",
            receiverStatus: "waiting_details",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };

        await sendMessage(message);

        return db.collection("exhibitions").doc(afterExhibition.id).set(
            {status: "waiting_details"},
            {merge: true}
        );
      } else if ( afterExhibition.status === ExhibitionStatus.CANCELED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {
                senderStatus: "request_canceled",
                receiverStatus: "request_canceled",
                exhibitionDetails: {
                  title: afterExhibition.title,
                  startDate: afterExhibition.startDate,
                  endDate: afterExhibition.endDate,
                  artworksCount: afterExhibition.artworks.length,
                },
              }},
              {merge: true}
          );
        });
      } else if ( afterExhibition.status === ExhibitionStatus.DECLINED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {
                senderStatus: "request_declined",
                receiverStatus: "request_declined",
              }},
              {merge: true}
          );
        });
      } else if ( afterExhibition.status === ExhibitionStatus.REVIEW) {
        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: afterExhibition.editedAt,
          isRead: false,
          senderId: afterExhibition.editedBy,
          payload: {
            senderStatus: "waiting_review",
            receiverStatus: "check_details",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };
        return sendMessage(message);
      } else if (afterExhibition.status === ExhibitionStatus.DETAILS_ACCEPTED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.receiverStatus", "==", "check_details")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {receiverStatus: "details_accepted"}},
              {merge: true}
          );
        });

        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: afterExhibition.editedBy,
          payload: {
            senderStatus: "waiting_opening",
            receiverStatus: "waiting_opening",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };
        return sendMessage(message);
      } else if (afterExhibition.status === ExhibitionStatus.DETAILS_CHANGED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.receiverStatus", "==", "check_details")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {receiverStatus: "details_changed"}},
              {merge: true}
          );
        });

        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: afterExhibition.editedAt,
          isRead: false,
          senderId: afterExhibition.editedBy,
          payload: {
            senderStatus: "waiting_review",
            receiverStatus: "check_details",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };
        return sendMessage(message);
      } else if (afterExhibition.status === ExhibitionStatus.OPEN) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.receiverStatus", "==", "waiting_opening")
            .where("payload.senderStatus", "==", "waiting_opening")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {receiverStatus: "open", senderStatus: "open"}},
              {merge: true}
          );
        });
        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: afterExhibition.editedBy,
          payload: {
            senderStatus: "view_exhibition",
            receiverStatus: "view_exhibition",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };
        return sendMessage(message);
      } else if (afterExhibition.status === ExhibitionStatus.CLOSED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(afterExhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.receiverStatus", "==", "open")
            .where("payload.senderStatus", "==", "open")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {payload: {receiverStatus: "close", senderStatus: "close"}},
              {merge: true}
          );
        });
        const message = <IMessage>{
          id: generateMessageId(afterExhibition.chatRoomId).id,
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: afterExhibition.editedBy,
          payload: {
            senderStatus: "closed",
            receiverStatus: "closed",
            exhibitionDetails: {
              title: afterExhibition.title,
              startDate: afterExhibition.startDate,
              endDate: afterExhibition.endDate,
              artworksCount: afterExhibition.artworks.length,
            },
          },
        };
        return sendMessage(message);
      }
      return;
    });


// Push notification
interface PushNotificationSend {
    notification: {
        title: string,
        body: string,
    }
}

interface PushNotificationSold {
    userId: string,
    senderName: string
    image: string,
    type: string,
    createdDate: Date,
}

enum NotificationTypes {
    PURCHASE = "Purchase"
}

enum ArtworkStatus {
    AVAILABLE = "Available",
    SOLD = "Sold"
}

const sendPushNotification =
    async (fcmToken: string, options: PushNotificationSend) => {
      await admin.messaging().sendToDevice(fcmToken, options);
    };


exports.soldArtwork = functions.firestore
    .document("artworks/{artworkId}")
    .onUpdate( async (snap) => {
      const artwork = snap.after.data();

      if (artwork.status === ArtworkStatus.SOLD) {
        const userId = artwork.userId;

        const user = await db.collection("users").doc(userId).get();
        const fcmToken = user.data()?.fcmToken;

        if (fcmToken) {
          const notification: PushNotificationSend = {
            notification: {
              title: "Artwork sold",
              body: "Tap here to check it out!",
            },
          };

          const notificationData: PushNotificationSold = {
            userId,
            senderName: "",
            image: artwork.images[0]?.url,
            type: NotificationTypes.PURCHASE,
            createdDate: new Date(),
          };

          await db.collection("notifications")
              .doc().set(notificationData);


          await sendPushNotification(fcmToken, notification);
        }
      }
    });
