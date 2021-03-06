import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {elasticsearch} from "./config";

const createAwsElasticsearchConnector = require("aws-elasticsearch-connector");

const {Client} = require("@elastic/elasticsearch");

admin.initializeApp();

const db = admin.firestore();
const AWS = require("aws-sdk");
const AWS_REGION = elasticsearch.region;

AWS.config.region = AWS_REGION;
AWS.config.update({
  credentials: new AWS.Credentials(
      elasticsearch.keyid,
      elasticsearch.secretkey
  ),
  region: AWS_REGION,
});

const client = new Client({
  ...createAwsElasticsearchConnector(AWS.config),
  node: elasticsearch.url,
});

enum Roles {
    COLLECTOR = "Collector",
    ARTIST = "Artist",
    VENUE_MANAGER = "VenueManager",
    GUEST = "Guest"
}

interface Dimensions {
    height: number,
    width: number,
    thickness: number
}

interface Image {
    width: number
    height: number
    url: string
}

interface Artwork {
    id: string,
    key: string
    title: string,
    description: string,
    category: string,
    year: string,
    dimensions: Dimensions | null,
    materials: string[]
    styles: string[],
    keywords: string[],
    edition: string,
    status: string,
    frame: boolean,
    price: number,
    userName: string,
    orientation: string,
    userId: string,
    shopify: Shopify
    images: Image[],
    venue?: Venue
}

interface Shopify {
    productId: number
    variantsId: number[]
}

interface ElasticQuery {
    collection: any,
    query: any
}

interface Venue {
    userId: string
    title: string
    venueGooglePlaceId: string
    name: string
    reviews: number
    rating: number
    type: string
    verified: boolean
    image: string | null
}

enum ArtworkStatus {
    AVAILABLE = "Available",
    SOLD = "Sold",
    EXHIBITED = "Exhibited"
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
    venue: doc.venue,
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
      const {after} = snap;
      await client.index({
        index: "artworks",
        type: "_doc",
        id: after.id,
        body: mapArtwork(after.id, after.data()),
      });
    });

// Delete Artwork
exports.deleteArtwork = functions.firestore
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
    venue: Venue
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
    text: string
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

      if (exhibition.status === ExhibitionStatus.REQUESTED) {
        const chatRoomRef = createChatRoomRef();
        const chat = {
          exhibitionId: exhibition.id,
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


        const recipientUserId = exhibition.members
            .find((item) => item != exhibition.createdBy);

        if (recipientUserId) {
          const recipientUser = await db
              .collection("users")
              .doc(recipientUserId).get();

          const userData = recipientUser.data();

          if (userData?.fcmToken && userData?.notifications.exhibitions) {
            const sendNotification: PushNotificationSend = {
              data: {
                routeName: "Chat",
              },
              notification: {
                title: "You received a new message",
                body: "Tap here to check it out!",
              },
            };
            await sendPushNotification(userData.fcmToken, sendNotification);
          }

          const notification: PushNotificationRequestExhibition = {
            status: exhibition.status,
            image: exhibition.artworks[0]?.images[0]?.url || null,
            userId: recipientUserId,
            senderName: exhibition.venue.title,
            type: NotificationTypes.REQUEST_EXHIBITION,
            createdDate: new Date(),
            isSeen: false,
          };
          await db.collection("notifications").doc().set(notification);
        }
      }
    });

// Update Exhibition
exports.onUpdateExhibition = functions.firestore
    .document("exhibitions/{exhibitionId}")
    .onUpdate(async (snap) => {
      const exhibition = mapExhibition(
          snap.after.id,
          snap.after.data()
      );

      const {status, members, createdBy} = exhibition;

      const receiverUserId = members
          .find((item) => item != createdBy);

      const receiverUser = receiverUserId ? await db.collection("users")
          .doc(receiverUserId).get() : null;
      const creatorUser = await db.collection("users")
          .doc(createdBy).get();

      const _receiverUser = receiverUser?.data();
      const _creatorUser = creatorUser?.data();

      const generateMessageId = (chatRoomId: string) => db
          .collection("chatRoom")
          .doc(chatRoomId).collection("messages")
          .doc();

      const sendMessage = (msg: IMessage) => {
        const chatId = exhibition.chatRoomId;
        const chatRoomRef = db.collection("chatRoom").doc(chatId);

        return db.collection("chatRoom")
            .doc(chatRoomRef.id)
            .collection("messages")
            .doc(msg.id)
            .set(msg);
      };

      const mapSenderUser = (userId: string) => {
        if (_receiverUser?.userId === userId) {
          return _receiverUser;
        }
        return _creatorUser;
      };

      const mapSenderName = (user: any) => {
        if (user.role === Roles.ARTIST) {
          return `${user.firstName} ${user.lastName}`;
        }
        if (user.role === Roles.VENUE_MANAGER) {
          return exhibition?.venue.title;
        }
        return "";
      };

      const sendPushMessage = async (
          senderUser: any,
          recepientUser: any
      ) => {
        if (recepientUser?.notifications.exhibitions) {
          const sendNotification: PushNotificationSend = {
            notification: {
              title: "You received a new message",
              body: "Tap here to check it out!",
            },
          };

          await sendPushNotification(recepientUser.fcmToken, sendNotification);
        }
        const notification: PushNotificationChangeStatusExhibition = {
          status: status,
          type: NotificationTypes.MESSAGE,
          userId: recepientUser.userId,
          senderName: mapSenderName(senderUser),
          createdDate: new Date(),
          isSeen: false,
        };
        await db.collection("notifications").doc().set(notification);
      };

      if (status === ExhibitionStatus.ACCEPTED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {
                payload: {
                  receiverStatus: "request_accepted",
                  senderStatus: "request_accepted",
                  exhibitionDetails: {
                    title: exhibition.title,
                    startDate: exhibition.startDate,
                    endDate: exhibition.endDate,
                    artworksCount: exhibition.artworks.length,
                  },
                },
              },
              {merge: true}
          );
        });

        const message = <IMessage>{
          id: generateMessageId(exhibition.chatRoomId).id,
          type: "action",
          createdAt: new Date(),
          isRead: false,
          senderId: exhibition.createdBy,
          payload: {
            senderStatus: "waiting_details",
            receiverStatus: "waiting_details",
            exhibitionDetails: {
              title: exhibition.title,
              startDate: exhibition.startDate,
              endDate: exhibition.endDate,
              artworksCount: exhibition.artworks.length,
            },
          },
        };

        await sendMessage(message);
        await sendPushMessage(_receiverUser, _creatorUser);
      } else if (status === ExhibitionStatus.CANCELED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {
                payload: {
                  senderStatus: "request_canceled",
                  receiverStatus: "request_canceled",
                  exhibitionDetails: {
                    title: exhibition.title,
                    startDate: exhibition.startDate,
                    endDate: exhibition.endDate,
                    artworksCount: exhibition.artworks.length,
                  },
                },
              },
              {merge: true}
          );
        });
        await sendPushMessage(_creatorUser, _receiverUser);
      } else if (status === ExhibitionStatus.DECLINED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
            .collection("messages");

        const messages = await messagesRef
            .where("payload.senderStatus", "==", "requested")
            .where("payload.receiverStatus", "==", "request_waiting_approve")
            .get();

        messages.forEach((doc) => {
          messagesRef.doc(doc.id).set(
              {
                payload: {
                  senderStatus: "request_declined",
                  receiverStatus: "request_declined",
                },
              },
              {merge: true}
          );
        });

        await sendPushMessage(_receiverUser, _creatorUser);
      } else if (status === ExhibitionStatus.REVIEW) {
        if (exhibition.editedBy) {
          const message = <IMessage>{
            id: generateMessageId(exhibition.chatRoomId).id,
            type: "action",
            createdAt: exhibition.editedAt,
            isRead: false,
            senderId: exhibition.editedBy,
            payload: {
              senderStatus: "waiting_review",
              receiverStatus: "check_details",
              exhibitionDetails: {
                title: exhibition.title,
                startDate: exhibition.startDate,
                endDate: exhibition.endDate,
                artworksCount: exhibition.artworks.length,
              },
            },
          };

          const receiver = members.find((item) => item !== exhibition.editedBy);

          if (receiver) {
            await sendPushMessage(
                mapSenderUser(exhibition.editedBy), mapSenderUser(receiver)
            );
            return sendMessage(message);
          }
        }
      } else if (status === ExhibitionStatus.DETAILS_ACCEPTED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
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

        if (exhibition.editedBy) {
          const message = <IMessage>{
            id: generateMessageId(exhibition.chatRoomId).id,
            type: "action",
            createdAt: new Date(),
            isRead: false,
            senderId: exhibition.editedBy,
            payload: {
              senderStatus: "waiting_opening",
              receiverStatus: "waiting_opening",
              exhibitionDetails: {
                title: exhibition.title,
                startDate: exhibition.startDate,
                endDate: exhibition.endDate,
                artworksCount: exhibition.artworks.length,
              },
            },
          };

          const receiver = members.find((item) => item !== exhibition.editedBy);

          if (receiver) {
            await sendPushMessage(
                mapSenderUser(exhibition.editedBy), mapSenderUser(receiver)
            );
            return sendMessage(message);
          }
        }
      } else if (status === ExhibitionStatus.DETAILS_CHANGED) {
        if (exhibition.editedBy) {
          const messagesRef = db
              .collection("chatRoom")
              .doc(exhibition.chatRoomId)
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
            id: generateMessageId(exhibition.chatRoomId).id,
            type: "action",
            createdAt: exhibition.editedAt,
            isRead: false,
            senderId: exhibition.editedBy,
            payload: {
              senderStatus: "waiting_review",
              receiverStatus: "check_details",
              exhibitionDetails: {
                title: exhibition.title,
                startDate: exhibition.startDate,
                endDate: exhibition.endDate,
                artworksCount: exhibition.artworks.length,
              },
            },
          };

          const receiver = members.find((item) => item !== exhibition.editedBy);

          if (receiver) {
            await sendPushMessage(
                mapSenderUser(exhibition.editedBy), mapSenderUser(receiver)
            );
            return sendMessage(message);
          }
        }
      } else if (status === ExhibitionStatus.OPEN) {
        for (let i = 0; i < exhibition.artworks.length; i++) {
          const artwork = exhibition.artworks[i];

          if (artwork?.id) {
            await db.collection("artworks").doc(artwork.id).update({
              status: ArtworkStatus.EXHIBITED,
              venue: exhibition.venue,
            });
          }
        }

        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
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

        if (exhibition.editedBy) {
          const message = <IMessage>{
            id: generateMessageId(exhibition.chatRoomId).id,
            type: "action",
            createdAt: new Date(),
            isRead: false,
            senderId: exhibition.editedBy,
            payload: {
              senderStatus: "view_exhibition",
              receiverStatus: "view_exhibition",
              exhibitionDetails: {
                title: exhibition.title,
                startDate: exhibition.startDate,
                endDate: exhibition.endDate,
                artworksCount: exhibition.artworks.length,
              },
            },
          };

          const receiver = members.find((item) => item !== exhibition.editedBy);

          if (receiver) {
            await sendPushMessage(
                mapSenderUser(exhibition.editedBy), mapSenderUser(receiver)
            );
            return sendMessage(message);
          }
        }
      } else if (status === ExhibitionStatus.CLOSED) {
        const messagesRef = db
            .collection("chatRoom")
            .doc(exhibition.chatRoomId)
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

        if (exhibition.editedBy) {
          const message = <IMessage>{
            id: generateMessageId(exhibition.chatRoomId).id,
            type: "action",
            createdAt: new Date(),
            isRead: false,
            senderId: exhibition.editedBy,
            payload: {
              senderStatus: "closed",
              receiverStatus: "closed",
              exhibitionDetails: {
                title: exhibition.title,
                startDate: exhibition.startDate,
                endDate: exhibition.endDate,
                artworksCount: exhibition.artworks.length,
              },
            },
          };
          const receiver = members.find((item) => item !== exhibition.editedBy);

          if (receiver) {
            await sendPushMessage(
                mapSenderUser(exhibition.editedBy), mapSenderUser(receiver)
            );
            return sendMessage(message);
          }
        }
      }
      return;
    });


// Push notification
interface PushNotificationSend {
    data?: {
        routeName: string
    },
    notification: {
        title: string,
        body: string,
        routeName?: string
    }
}

interface PushNotification {
    userId: string,
    senderName: string
    type: string
    createdDate: Date
    isSeen: boolean
}

interface PushNotificationSold extends PushNotification {
    image: string
}

interface PushNotificationRequestExhibition extends PushNotification {
    status: ExhibitionStatus
    image: string | null
}

interface PushNotificationChangeStatusExhibition extends PushNotification {
    status: ExhibitionStatus,
}

enum NotificationTypes {
    PURCHASE = "Purchase",
    REQUEST_EXHIBITION = "RequestExhibition",
    MESSAGE = "Message"
}

const sendPushNotification =
    async (fcmToken: string, options: PushNotificationSend) => {
      await admin.messaging().sendToDevice(fcmToken, options);
    };

// Push sold artwork
exports.soldArtwork = functions.firestore
    .document("orders/{userId}/orders/{orderId}")
    .onWrite(async (snap) => {
      const order = snap.after.data();
      const artworks = order?.artworkIds;

      for (let i = 0; i < artworks.length; i++) {
        const artworkId = artworks[i];
        const artwork = await db
            .collection("artworks")
            .doc(artworkId)
            .get();

        const userId = artwork?.data()?.userId;

        if (userId) {
          const user = await db.collection("users").doc(userId).get();
          const userData = user.data();

          if (userData?.fcmToken && userData?.notifications.purchases) {
            const sendNotification: PushNotificationSend = {
              notification: {
                title: "Artwork sold",
                body: "Tap here to check it out!",
              },
            };
            await sendPushNotification(userData.fcmToken, sendNotification);
          }

          const notification: PushNotificationSold = {
            userId,
            senderName: order?.buyerName,
            image: order?.image,
            type: NotificationTypes.PURCHASE,
            createdDate: new Date(),
            isSeen: false,
          };
          await db.collection("notifications").doc().set(notification);
        }
      }
    });

// Push new message
exports.onNewMessage = functions.firestore
    .document("chatRoom/{chatRoomId}/messages/{messageId}")
    .onCreate(async (snap, context) => {
      const message = snap.data();

      if (message.type !== "action") {
        const senderId = message.senderId;
        const chatRoomId = context.params.chatRoomId;

        const chatRoomRef = await db.collection("chatRoom")
            .doc(chatRoomId).get();
        const chatRoom = chatRoomRef.data();
        const exhibitionId = chatRoom?.exhibitionId;

        const exhibitionRef = await db.collection("exhibitions")
            .doc(exhibitionId).get();
        const exhibition = exhibitionRef.data();

        const recipientUserId = exhibition?.members
                .find((item: string) => item !== senderId);
        const recipientUserRef = await db.collection("users")
            .doc(recipientUserId).get();
        const recipientUser = recipientUserRef.data();

        if (recipientUser) {
          const mapSenderName = (user: any) => {
            if (user.role === Roles.ARTIST) {
              return `${user.firstName} ${user.lastName}`;
            }
            if (user.role === Roles.VENUE_MANAGER) {
              return exhibition?.venue.title || "";
            }
            return "";
          };

          const senderUserRef = await db.collection("users")
              .doc(senderId).get();
          const senderUser = senderUserRef.data();

          if (recipientUser?.fcmToken &&
              recipientUser?.notifications.messages) {
            const sendNotification: PushNotificationSend = {
              data: {
                routeName: "Chat",
              },
              notification: {
                title: "You received a new message",
                body: "Tap here to check it out!",
              },
            };

            await sendPushNotification(recipientUser?.fcmToken,
                sendNotification);
          }
          const notification: PushNotification = {
            type: NotificationTypes.MESSAGE,
            userId: recipientUserId,
            senderName: mapSenderName(senderUser),
            createdDate: new Date(),
            isSeen: false,
          };
          await db.collection("notifications").doc().set(notification);
        }
      }
    });
