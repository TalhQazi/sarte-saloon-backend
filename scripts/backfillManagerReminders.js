/**
 * One-time backfill: create MANAGER copies of existing advance_booking_reminder
 * notifications that currently only exist for admins.
 *
 * Why: reminders are stored as one copy per recipient (so each recipient keeps
 * their own read/delete state). Older bookings only created admin copies, so the
 * Manager > Reminder tab looks nearly empty. This mirrors every distinct admin
 * reminder to all current managers, skipping any that already have a manager copy.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage:  node scripts/backfillManagerReminders.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const Manager = require("../models/Manager");
const Employee = require("../models/Employee");

// Build a stable key for a reminder so admin/manager copies of the SAME reminder match.
const keyOf = (n) =>
  n.relatedEntityId
    ? `rel:${String(n.relatedEntityId)}`
    : `msg:${n.message}|${n.scheduledFor ? new Date(n.scheduledFor).getTime() : "none"}`;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // 1) Gather current managers (credential + face-auth), same set notifyAllManagers targets.
  const credentialManagers = await Manager.find({ isActive: { $ne: false } });
  const faceAuthManagers = await Employee.find({
    role: { $regex: /^manager$/i },
    isActive: true,
  });

  const managerTargets = [
    ...credentialManagers.map((m) => ({ id: m._id, model: "Manager" })),
    ...faceAuthManagers.map((m) => ({ id: m._id, model: "Employee" })),
  ];

  if (managerTargets.length === 0) {
    console.warn("⚠️  No managers found — nothing to backfill.");
    await mongoose.disconnect();
    return;
  }
  console.log(`👤 Managers to receive copies: ${managerTargets.length}`);

  // 2) All admin reminder copies (source of truth for which reminders exist).
  const adminReminders = await Notification.find({
    type: "advance_booking_reminder",
    recipientType: "admin",
    isActive: true,
  });

  // Existing manager reminders — so we don't duplicate.
  const existingManagerReminders = await Notification.find({
    type: "advance_booking_reminder",
    recipientType: "manager",
    isActive: true,
  });
  const managerKeys = new Set(existingManagerReminders.map(keyOf));

  // 3) De-dupe admin reminders down to one representative per logical reminder.
  const representatives = new Map();
  for (const n of adminReminders) {
    const k = keyOf(n);
    if (!representatives.has(k)) representatives.set(k, n);
  }

  const toInsert = [];
  let skipped = 0;
  for (const [k, src] of representatives) {
    if (managerKeys.has(k)) {
      skipped += 1;
      continue; // manager copy already exists for this reminder
    }
    for (const t of managerTargets) {
      toInsert.push({
        title: src.title,
        message: src.message,
        type: "advance_booking_reminder",
        recipientType: "manager",
        recipientId: t.id,
        recipientModel: t.model,
        relatedEntityType: src.relatedEntityType || "advance_booking",
        relatedEntityId: src.relatedEntityId || null,
        scheduledFor: src.scheduledFor || null,
        sentAt: src.sentAt || null,
        priority: src.priority || "high",
        isRead: false,
        isActive: true,
      });
    }
  }

  console.log(`📋 Distinct admin reminders: ${representatives.size}`);
  console.log(`⏭️  Already had manager copies: ${skipped}`);

  if (toInsert.length === 0) {
    console.log("✅ Nothing to backfill — managers are already up to date.");
  } else {
    await Notification.insertMany(toInsert);
    console.log(`✅ Inserted ${toInsert.length} manager reminder copies.`);
  }

  await mongoose.disconnect();
  console.log("✅ Done.");
})().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
