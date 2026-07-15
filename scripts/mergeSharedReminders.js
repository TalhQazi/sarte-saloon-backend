/**
 * One-time migration: consolidate advance_booking_reminder notifications into a
 * single SHARED doc per booking (recipientType: "both").
 *
 * Background: reminders used to be stored as separate copies — one (or more) for
 * admins and one for managers. That made read/delete state diverge between the two
 * panels. A booking reminder is a single "call the client" task, so it should be one
 * document that both panels see; reading or deleting it on either side then updates
 * both.
 *
 * For each booking (grouped by relatedEntityId) this:
 *   - skips bookings that already have an active "both" doc (idempotent),
 *   - otherwise, if any copy is still visible, creates one merged "both" doc:
 *       isActive = any copy active   (visible if anyone still kept it)
 *       isRead   = every copy read   (stays unread if either side hadn't read it)
 *   - deactivates the old per-role copies so only the shared doc remains.
 *
 * Reminders with no relatedEntityId (older ad-hoc/test entries) are left untouched.
 *
 * Safe to run multiple times.
 *
 * Usage:  node scripts/mergeSharedReminders.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const all = await Notification.find({
    type: "advance_booking_reminder",
    relatedEntityId: { $ne: null },
  });

  // Group by booking.
  const groups = new Map();
  for (const n of all) {
    const k = String(n.relatedEntityId);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }

  let created = 0;
  let alreadyShared = 0;
  let skippedInactive = 0;
  let deactivated = 0;

  for (const [, docs] of groups) {
    const activeBoth = docs.find(
      (d) => d.recipientType === "both" && d.isActive
    );

    if (activeBoth) {
      // Already migrated — just make sure no stale per-role copies stay visible.
      for (const d of docs) {
        if (d._id.equals(activeBoth._id)) continue;
        if (d.isActive) {
          d.isActive = false;
          await d.save();
          deactivated += 1;
        }
      }
      alreadyShared += 1;
      continue;
    }

    const anyActive = docs.some((d) => d.isActive);
    if (!anyActive) {
      skippedInactive += 1; // whole booking already dismissed everywhere
      continue;
    }

    const src = docs[0];
    const mergedRead = docs.every((d) => d.isRead);

    await Notification.create({
      title: src.title,
      message: src.message,
      type: "advance_booking_reminder",
      recipientType: "both",
      recipientModel: "Admin", // placeholder; recipientId is null for a broadcast
      recipientId: null,
      relatedEntityType: src.relatedEntityType || "advance_booking",
      relatedEntityId: src.relatedEntityId,
      scheduledFor: src.scheduledFor || null,
      sentAt: src.sentAt || null,
      priority: src.priority || "high",
      isRead: mergedRead,
      isActive: true,
    });
    created += 1;

    for (const d of docs) {
      d.isActive = false;
      await d.save();
      deactivated += 1;
    }
  }

  console.log(`📋 Bookings processed: ${groups.size}`);
  console.log(`✅ Shared reminders created: ${created}`);
  console.log(`↩️  Already shared (skipped): ${alreadyShared}`);
  console.log(`🗑️  Fully-dismissed bookings skipped: ${skippedInactive}`);
  console.log(`⚙️  Old per-role copies deactivated: ${deactivated}`);

  await mongoose.disconnect();
  console.log("✅ Done.");
})().catch((e) => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
