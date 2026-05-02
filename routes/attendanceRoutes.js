const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");

// Helper to get controller lazily to avoid circular dependencies/init issues
const getController = () => require("../controller/attendanceController");

// Employee Check-In with live picture (requires authentication)
router.post("/checkin", authenticateToken, (req, res, next) => getController().handleFileUpload(req, res, next), (req, res) => getController().employeeCheckIn(req, res));

// Employee Check-Out with live picture (requires authentication)
router.post("/checkout", authenticateToken, (req, res, next) => getController().handleFileUpload(req, res, next), (req, res) => getController().employeeCheckOut(req, res));

// Manual Attendance Request (for late employees) - no auth required
router.post("/manual-request", (req, res) => getController().manualAttendanceRequest(req, res));

// Get Pending Manual Requests (Admin) - requires authentication
router.get("/pending-requests", authenticateToken, (req, res) => getController().getPendingManualRequests(req, res));

// Approve/Decline Manual Request (Admin) - requires authentication
router.put(
  "/approve-request/:requestId",
  authenticateToken,
  (req, res) => getController().approveDeclineManualRequest(req, res)
);

// Get All Attendance Records (with filters) - requires authentication
router.get("/all", authenticateToken, (req, res) => getController().getAllAttendanceRecords(req, res));

// Admin manual attendance for any employee/manager - requires authentication
router.post(
  "/admin/manual",
  authenticateToken,
  (req, res) => getController().adminRecordEmployeeAttendance(req, res)
);

// Mark Absent Employees (Admin - Daily Task) - requires authentication
router.post("/mark-absent", authenticateToken, (req, res) => getController().markAbsentEmployees(req, res));

// Delete Attendance Record (Admin) - requires authentication
router.delete("/:id", authenticateToken, (req, res) => {
  const controller = getController();
  if (controller && controller.deleteAttendanceRecord) {
    return controller.deleteAttendanceRecord(req, res);
  } else {
    console.error("❌ [AttendanceRoutes] deleteAttendanceRecord is undefined!");
    return res.status(500).json({ message: "Delete handler missing in controller" });
  }
});

module.exports = router;
