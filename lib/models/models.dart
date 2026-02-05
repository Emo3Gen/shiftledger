/// Location model
class Location {
  Location({
    required this.id,
    required this.name,
    required this.city,
  });

  final String id;
  final String name;
  final String city;
}

/// Employee model
class Employee {
  Employee({
    required this.id,
    required this.name,
    required this.role,
    required this.locationId,
    required this.ratePerHour,
    this.minHoursPerWeek,
  });

  final String id;
  final String name;
  final String role; // 'junior', 'senior', 'admin'
  final String locationId;
  final int ratePerHour;
  final int? minHoursPerWeek;
}

/// Shift model
class Shift {
  Shift({
    required this.id,
    required this.weekId,
    required this.locationId,
    required this.date,
    required this.slot,
    required this.shiftType,
    required this.hours,
    required this.cleaningPlanned,
    required this.cleaningConfirmed,
    this.plannedEmployeeId,
    this.actualEmployeeId,
    this.cleaningRecordId,
    this.note,
  });

  final String id;
  final String weekId;
  final String locationId;
  final String date; // yyyy-mm-dd
  final String slot; // 'morning' or 'evening'
  final String shiftType; // 'normal', 'replacement', 'training'
  final double hours;
  final bool cleaningPlanned;
  final bool cleaningConfirmed;
  final String? plannedEmployeeId;
  final String? actualEmployeeId;
  final String? cleaningRecordId;
  final String? note;
}

/// CleaningRecord model
class CleaningRecord {
  CleaningRecord({
    required this.id,
    required this.locationId,
    required this.dateFor,
    required this.performedByEmployeeId,
    required this.createdAt,
    required this.flagged,
    this.note,
  });

  final String id;
  final String locationId;
  final String dateFor; // yyyy-mm-dd
  final String performedByEmployeeId;
  final DateTime createdAt;
  final bool flagged;
  final String? note;
}

/// ExtraClassType model
class ExtraClassType {
  ExtraClassType({
    required this.id,
    required this.locationId,
    required this.name,
    required this.ratePerChild,
    required this.active,
  });

  final String id;
  final String locationId;
  final String name;
  final int ratePerChild;
  final bool active;
}

/// ExtraClassRecord model
class ExtraClassRecord {
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
}

/// Week model
class Week {
  Week({
    required this.id,
    required this.locationId,
    required this.startDate,
  });

  final String id;
  final String locationId;
  final DateTime startDate; // Monday
}

/// CleaningRule model
class CleaningRule {
  CleaningRule({
    required this.locationId,
    required this.daysOfWeek,
    required this.appliesToSlot,
    required this.cleaningRate,
  });

  final String locationId;
  final List<int> daysOfWeek; // 1=Monday ... 7=Sunday
  final String appliesToSlot; // 'evening'
  final int cleaningRate;
}
