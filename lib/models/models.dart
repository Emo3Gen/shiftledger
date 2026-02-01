/// Location model
class Location {
  final String id;
  final String name;
  final String city;

  Location({
    required this.id,
    required this.name,
    required this.city,
  });
}

/// Employee model
class Employee {
  final String id;
  final String name;
  final String role; // 'junior', 'senior', 'admin'
  final String locationId;
  final int ratePerHour;
  final int? minHoursPerWeek;

  Employee({
    required this.id,
    required this.name,
    required this.role,
    required this.locationId,
    required this.ratePerHour,
    this.minHoursPerWeek,
  });
}

/// Shift model
class Shift {
  final String id;
  final String weekId;
  final String locationId;
  final String date; // yyyy-mm-dd
  final String slot; // 'morning' or 'evening'
  final String? plannedEmployeeId;
  final String? actualEmployeeId;
  final String shiftType; // 'normal', 'replacement', 'training'
  final double hours;
  final bool cleaningPlanned;
  final bool cleaningConfirmed;
  final String? cleaningRecordId;
  final String? note;

  Shift({
    required this.id,
    required this.weekId,
    required this.locationId,
    required this.date,
    required this.slot,
    this.plannedEmployeeId,
    this.actualEmployeeId,
    required this.shiftType,
    required this.hours,
    required this.cleaningPlanned,
    required this.cleaningConfirmed,
    this.cleaningRecordId,
    this.note,
  });
}

/// CleaningRecord model
class CleaningRecord {
  final String id;
  final String locationId;
  final String dateFor; // yyyy-mm-dd
  final String performedByEmployeeId;
  final DateTime createdAt;
  final bool flagged;
  final String? note;

  CleaningRecord({
    required this.id,
    required this.locationId,
    required this.dateFor,
    required this.performedByEmployeeId,
    required this.createdAt,
    required this.flagged,
    this.note,
  });
}

/// ExtraClassType model
class ExtraClassType {
  final String id;
  final String locationId;
  final String name;
  final int ratePerChild;
  final bool active;

  ExtraClassType({
    required this.id,
    required this.locationId,
    required this.name,
    required this.ratePerChild,
    required this.active,
  });
}

/// ExtraClassRecord model
class ExtraClassRecord {
  final String id;
  final String locationId;
  final String shiftId;
  final String date; // yyyy-mm-dd
  final String employeeId;
  final String extraClassTypeId;
  final int childrenCount;
  final int ratePerChildSnapshot;
  final int amount;
  final DateTime createdAt;
  final bool flagged;
  final String? note;

  ExtraClassRecord({
    required this.id,
    required this.locationId,
    required this.shiftId,
    required this.date,
    required this.employeeId,
    required this.extraClassTypeId,
    required this.childrenCount,
    required this.ratePerChildSnapshot,
    required this.amount,
    required this.createdAt,
    required this.flagged,
    this.note,
  });
}
