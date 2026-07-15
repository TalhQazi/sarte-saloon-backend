/**
 * One-time backfill: create MANAGER copies of existing advance_booking_reminder
 * notifications that currently only exist for admins.
 *
 * Why: older bookings only created admin reminder notifications, so the
 * Manager > Reminder tab looks nearly empty. The Manager tab query matches every
 * notification whose recipientType is "manager", so we create exactly ONE broadcast
 * doc per booking (recipientType "manager", recipientId null) — this reaches all
 * managers without producing duplicate rows.
 *
 * Safe to run multiple times (idempotent): skips any booking that already has a
 * manager reminder.
 *
 * Usage:  node scripts/backfillManagerReminders.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");

// Stable key so admin/manager copies of the SAME reminder match.
const keyOf = (n) =>
  n.relatedEntityId
    ? `rel:${String(n.relatedEntityId)}`
    : `msg:${n.message}|${n.scheduledFor ? new Date(n.scheduledFor).getTime() : "none"}`;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // Source of truth: every admin reminder copy that still exists.
  const adminReminders = await Notification.find({
    type: "advance_booking_reminder",
    recipientType: "admin",
    isActive: true,
  });

  // Reminders that already have a manager copy — so we don't duplicate.
  const existingManagerReminders = await Notification.find({
    type: "advance_booking_reminder",
    recipientType: "manager",
    isActive: true,
  });
  const managerKeys = new Set(existingManagerReminders.map(keyOf));

  // One representative per distinct booking/reminder.
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
      continue; // manager already has this reminder
    }
    toInsert.push({
      title: src.title,
      message: src.message,
      type: "advance_booking_reminder",
      recipientType: "manager",
      recipientModel: "Manager",
      recipientId: null, // broadcast to all managers
      relatedEntityType: src.relatedEntityType || "advance_booking",
      relatedEntityId: src.relatedEntityId || null,
      scheduledFor: src.scheduledFor || null,
      sentAt: src.sentAt || null,
      priority: src.priority || "high",
      isRead: false,
      isActive: true,
    });
  }

  console.log(`📋 Distinct admin reminders: ${representatives.size}`);
  console.log(`⏭️  Already had a manager copy: ${skipped}`);

  if (toInsert.length === 0) {
    console.log("✅ Nothing to backfill — managers are already up to date.");
  } else {
    await Notification.insertMany(toInsert);
    console.log(`✅ Inserted ${toInsert.length} manager reminder(s).`);
  }

  await mongoose.disconnect();
  console.log("✅ Done.");
})().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
