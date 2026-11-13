
const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Initialize Firebase Admin SDK.
initializeApp();

const db = getFirestore();

// Limit simultaneous function instances.
setGlobalOptions({ maxInstances: 10 });

// Convert Firestore dates into readable strings.
function formatEventDate(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  let date = null;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  });
}

// Automatically add checked-in events to public profiles.
exports.syncParticipatedEvent = onDocumentCreated(
  "communityEvents/{eventId}/attendees/{studentUid}",
  async (event) => {
    try {
      const attendeeSnapshot = event.data;

      if (!attendeeSnapshot) {
        logger.warn("No attendee data found.");
        return;
      }

      const { eventId, studentUid } = event.params;
      const attendee = attendeeSnapshot.data();

      // Verify that the attendee document belongs to this student.
      if (attendee.uid !== studentUid) {
        logger.warn("Attendee UID mismatch.", { eventId, studentUid });
        return;
      }

      const eventRef = db.collection("communityEvents").doc(eventId);
      const profileRef = db.collection("publicProfiles").doc(studentUid);

      // Fetch the event and public profile.
      const [eventSnapshot, profileSnapshot] = await Promise.all([
        eventRef.get(),
        profileRef.get()
      ]);

      if (!eventSnapshot.exists) {
        logger.warn("Event document not found.", { eventId });
        return;
      }

      if (!profileSnapshot.exists) {
        logger.warn("Public profile not found.", { studentUid });
        return;
      }

      const eventData = eventSnapshot.data();

      const participation = {
        eventId: eventId,
        title: eventData.title || eventData.name || "AD ASTRA BIT Event",
        date: formatEventDate(eventData.eventDate || eventData.date)
      };

      // Transaction prevents duplicate entries, including trigger retries.
      const result = await db.runTransaction(async (transaction) => {
        const latestProfile = await transaction.get(profileRef);

        if (!latestProfile.exists) {
          return "profile-missing";
        }

        const profileData = latestProfile.data();
        const participatedEvents = Array.isArray(profileData.participatedEvents)
          ? profileData.participatedEvents
          : [];

        // Do not add the same event twice.
        const alreadyParticipated = participatedEvents.some(
          (item) =>
            item &&
            typeof item === "object" &&
            item.eventId === eventId
        );

        if (alreadyParticipated) {
          return "already-added";
        }

        transaction.update(profileRef, {
          participatedEvents: [
            ...participatedEvents,
            participation
          ],
          updatedAt: FieldValue.serverTimestamp()
        });

        return "added";
      });

      if (result === "added") {
        logger.info("Event added to student's public profile.", {
          studentUid,
          eventId,
          title: participation.title
        });
      } else {
        logger.info("Participation was not added.", {
          studentUid,
          eventId,
          reason: result
        });
      }

    } catch (error) {
      logger.error("Failed to sync participated event.", error);
      throw error;
    }
  }
);
