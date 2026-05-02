const controller = require('./controller/attendanceController');
console.log('Exports:', Object.keys(controller));
console.log('deleteAttendanceRecord:', typeof controller.deleteAttendanceRecord);
