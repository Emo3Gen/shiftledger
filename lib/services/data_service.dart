import 'package:uuid/uuid.dart';
import '../models/models.dart';
import 'mock_data.dart';

class DataService {
  final _uuid = const Uuid();
  
  // In-memory storage (will be replaced with API later)
  late List<Location> _locations;
  late List<Employee> _employees;
  late List<Week> _weeks;
  late List<Shift> _shifts;
  late List<CleaningRecord> _cleaningRecords;
  late List<ExtraClassRecord> _extraClassRecords;
  late List<ExtraClassType> _extraClassTypes;
  late List<CleaningRule> _cleaningRules;
  double _defaultMorningHours = 5.0;
  double _defaultEveningHours = 7.0;

  DataService() {
    _initializeData();
  }

  void _initializeData() {
    _locations = MockDataService.getLocations();
    _employees = MockDataService.getEmployees();
    _weeks = [MockDataService.getCurrentWeek()];
    _shifts = MockDataService.getShifts();
    _cleaningRecords = MockDataService.getCleaningRecords();
    _extraClassRecords = MockDataService.getExtraClassRecords();
    _extraClassTypes = MockDataService.getExtraClassTypes();
    _cleaningRules = [MockDataService.getCleaningRule()];
  }

  // Getters
  List<Location> getLocations() => List.unmodifiable(_locations);
  List<Employee> getEmployees() => List.unmodifiable(_employees);
  List<Week> getWeeks() => List.unmodifiable(_weeks);
  List<Shift> getShifts() => List.unmodifiable(_shifts);
  List<CleaningRecord> getCleaningRecords() => List.unmodifiable(_cleaningRecords);
  List<ExtraClassRecord> getExtraClassRecords() => List.unmodifiable(_extraClassRecords);
  List<ExtraClassType> getExtraClassTypes() => List.unmodifiable(_extraClassTypes);
  CleaningRule getCleaningRule() =>
      _cleaningRules.isNotEmpty ? _cleaningRules.first : _defaultCleaningRule();

  CleaningRule _defaultCleaningRule() => CleaningRule(
        locationId: '',
        daysOfWeek: [1, 2, 3, 4, 5],
        appliesToSlot: 'evening',
        cleaningRate: 400,
      );

  // Location
  Location? getLocationById(String id) {
    try {
      return _locations.firstWhere((l) => l.id == id);
    } catch (_) {
      return null;
    }
  }

  // Employee
  Employee? getEmployeeById(String id) {
    try {
      return _employees.firstWhere((e) => e.id == id);
    } catch (_) {
      return null;
    }
  }

  List<Employee> getEmployeesByLocation(String locationId) {
    return _employees.where((e) => e.locationId == locationId).toList();
  }

  List<Employee> getJuniorEmployees(String locationId) {
    return _employees
        .where((e) => e.locationId == locationId && e.role == 'junior')
        .toList();
  }

  void updateEmployee(Employee employee) {
    final index = _employees.indexWhere((e) => e.id == employee.id);
    if (index != -1) {
      _employees[index] = employee;
    }
  }

  void addEmployee(Employee employee) {
    _employees.add(employee);
  }

  Employee createEmployee({
    required String name,
    required String role,
    required String locationId,
    required int ratePerHour,
    int? minHoursPerWeek,
  }) {
    final e = Employee(
      id: _uuid.v4(),
      name: name,
      role: role,
      locationId: locationId,
      ratePerHour: ratePerHour,
      minHoursPerWeek: minHoursPerWeek,
    );
    _employees.add(e);
    return e;
  }

  // Week
  Week? getWeekById(String id) {
    try {
      return _weeks.firstWhere((w) => w.id == id);
    } catch (_) {
      return null;
    }
  }

  Week? getWeekByLocationAndDate(String locationId, DateTime date) {
    final monday = date.subtract(Duration(days: date.weekday - 1));
    try {
      return _weeks.firstWhere(
        (w) => w.locationId == locationId && 
              w.startDate.year == monday.year &&
              w.startDate.month == monday.month &&
              w.startDate.day == monday.day,
      );
    } catch (_) {
      return null;
    }
  }

  Week? getCurrentWeek() {
    if (_weeks.isEmpty) return null;
    // Return the most recent week or first one
    return _weeks.first;
  }

  // Shift
  List<Shift> getShiftsByWeek(String weekId) {
    return _shifts.where((s) => s.weekId == weekId).toList();
  }

  List<Shift> getShiftsByEmployee(String employeeId) {
    return _shifts.where((s) => s.actualEmployeeId == employeeId).toList();
  }

  Shift? getShiftById(String id) {
    try {
      return _shifts.firstWhere((s) => s.id == id);
    } catch (_) {
      return null;
    }
  }

  void updateShift(Shift shift) {
    final index = _shifts.indexWhere((s) => s.id == shift.id);
    if (index != -1) {
      _shifts[index] = shift;
    }
  }

  // CleaningRecord
  List<CleaningRecord> getCleaningRecordsByEmployee(String employeeId) {
    return _cleaningRecords
        .where((c) => c.performedByEmployeeId == employeeId)
        .toList();
  }

  List<CleaningRecord> getCleaningRecordsByWeek(String weekId) {
    final week = getWeekById(weekId);
    if (week == null) return [];
    
    final weekStart = week.startDate;
    final weekEnd = weekStart.add(const Duration(days: 6));
    
    return _cleaningRecords.where((c) {
      final date = DateTime.parse(c.dateFor);
      return date.isAfter(weekStart.subtract(const Duration(days: 1))) &&
             date.isBefore(weekEnd.add(const Duration(days: 1)));
    }).toList();
  }

  CleaningRecord? getCleaningRecordById(String id) {
    try {
      return _cleaningRecords.firstWhere((c) => c.id == id);
    } catch (_) {
      return null;
    }
  }

  CleaningRecord createCleaningRecord({
    required String locationId,
    required String dateFor,
    required String performedByEmployeeId,
    required bool flagged,
    String? note,
  }) {
    final record = CleaningRecord(
      id: _uuid.v4(),
      locationId: locationId,
      dateFor: dateFor,
      performedByEmployeeId: performedByEmployeeId,
      createdAt: DateTime.now(),
      flagged: flagged,
      note: note,
    );
    _cleaningRecords.add(record);
    return record;
  }

  // ExtraClassRecord
  List<ExtraClassRecord> getExtraClassRecordsByShift(String shiftId) {
    return _extraClassRecords.where((e) => e.shiftId == shiftId).toList();
  }

  List<ExtraClassRecord> getExtraClassRecordsByEmployee(String employeeId) {
    return _extraClassRecords.where((e) => e.employeeId == employeeId).toList();
  }

  List<ExtraClassRecord> getExtraClassRecordsByWeek(String weekId) {
    final week = getWeekById(weekId);
    if (week == null) return [];
    
    final weekStart = week.startDate;
    final weekEnd = weekStart.add(const Duration(days: 6));
    
    return _extraClassRecords.where((e) {
      final date = DateTime.parse(e.date);
      return date.isAfter(weekStart.subtract(const Duration(days: 1))) &&
             date.isBefore(weekEnd.add(const Duration(days: 1)));
    }).toList();
  }

  ExtraClassRecord createExtraClassRecord({
    required String locationId,
    required String shiftId,
    required String date,
    required String employeeId,
    required String extraClassTypeId,
    required int childrenCount,
    required int ratePerChildSnapshot,
    required bool flagged,
    String? note,
  }) {
    final amount = childrenCount * ratePerChildSnapshot;
    final record = ExtraClassRecord(
      id: _uuid.v4(),
      locationId: locationId,
      shiftId: shiftId,
      date: date,
      employeeId: employeeId,
      extraClassTypeId: extraClassTypeId,
      childrenCount: childrenCount,
      ratePerChildSnapshot: ratePerChildSnapshot,
      amount: amount,
      createdAt: DateTime.now(),
      flagged: flagged,
      note: note,
    );
    _extraClassRecords.add(record);
    return record;
  }

  // ExtraClassType
  List<ExtraClassType> getActiveExtraClassTypes(String locationId) {
    return _extraClassTypes
        .where((e) => e.locationId == locationId && e.active)
        .toList();
  }

  ExtraClassType? getExtraClassTypeById(String id) {
    try {
      return _extraClassTypes.firstWhere((e) => e.id == id);
    } catch (_) {
      return null;
    }
  }

  void addExtraClassType(ExtraClassType type) {
    _extraClassTypes.add(type);
  }

  ExtraClassType createExtraClassType({
    required String locationId,
    required String name,
    required int ratePerChild,
    bool active = true,
  }) {
    final t = ExtraClassType(
      id: _uuid.v4(),
      locationId: locationId,
      name: name,
      ratePerChild: ratePerChild,
      active: active,
    );
    _extraClassTypes.add(t);
    return t;
  }

  void updateExtraClassType(ExtraClassType type) {
    final index = _extraClassTypes.indexWhere((e) => e.id == type.id);
    if (index != -1) {
      _extraClassTypes[index] = type;
    }
  }

  List<ExtraClassType> getExtraClassTypesByLocation(String locationId) {
    return _extraClassTypes
        .where((e) => e.locationId == locationId)
        .toList();
  }

  // Settings
  void updateCleaningRule(CleaningRule rule) {
    final index =
        _cleaningRules.indexWhere((r) => r.locationId == rule.locationId);
    if (index != -1) {
      _cleaningRules[index] = rule;
    } else {
      _cleaningRules.add(rule);
    }
  }

  CleaningRule getCleaningRuleForLocation(String locationId) {
    try {
      return _cleaningRules.firstWhere((r) => r.locationId == locationId);
    } catch (_) {
      return CleaningRule(
        locationId: locationId,
        daysOfWeek: [1, 2, 3, 4, 5],
        appliesToSlot: 'evening',
        cleaningRate: 400,
      );
    }
  }

  double getDefaultHours(String slot) {
    return slot == 'morning' ? _defaultMorningHours : _defaultEveningHours;
  }

  void setDefaultHours(String slot, double hours) {
    if (slot == 'morning') {
      _defaultMorningHours = hours.clamp(0.5, 24.0);
    } else {
      _defaultEveningHours = hours.clamp(0.5, 24.0);
    }
  }

  // Payroll calculation
  Map<String, dynamic> calculatePayroll(String employeeId, String weekId) {
    final employee = getEmployeeById(employeeId);
    if (employee == null) {
      return {
        'baseHours': 0.0,
        'basePay': 0,
        'cleaningPay': 0,
        'extraPay': 0,
        'total': 0,
      };
    }

    // Base hours and pay
    final shifts = getShiftsByWeek(weekId)
        .where((s) => s.actualEmployeeId == employeeId)
        .toList();
    final baseHours = shifts.fold<double>(0.0, (sum, s) => sum + s.hours);
    final basePay = (baseHours * employee.ratePerHour).round();

    // Cleaning pay
    final cleaningRecords = getCleaningRecordsByWeek(weekId)
        .where((c) => c.performedByEmployeeId == employeeId)
        .toList();
    final rule = getCleaningRuleForLocation(employee.locationId);
    final cleaningPay = cleaningRecords.length * rule.cleaningRate;

    // Extra classes pay
    final extraRecords = getExtraClassRecordsByWeek(weekId)
        .where((e) => e.employeeId == employeeId)
        .toList();
    final extraPay = extraRecords.fold<int>(0, (sum, e) => sum + e.amount);

    final total = basePay + cleaningPay + extraPay;

    return {
      'baseHours': baseHours,
      'basePay': basePay,
      'cleaningPay': cleaningPay,
      'extraPay': extraPay,
      'total': total,
      'shifts': shifts,
      'cleaningRecords': cleaningRecords,
      'extraRecords': extraRecords,
    };
  }
}
