import '../models/models.dart';

class MockDataService {
  static List<Location> getLocations() {
    return [
      Location(
        id: 'loc_1',
        name: 'Архангельск',
        city: 'Архангельск',
      ),
    ];
  }

  static List<Employee> getEmployees() {
    return [
      Employee(
        id: 'emp_1',
        name: 'Карина',
        role: 'junior',
        locationId: 'loc_1',
        ratePerHour: 280,
        minHoursPerWeek: 22,
      ),
      Employee(
        id: 'emp_2',
        name: 'Иса',
        role: 'junior',
        locationId: 'loc_1',
        ratePerHour: 280,
      ),
      Employee(
        id: 'emp_3',
        name: 'Дарина',
        role: 'junior',
        locationId: 'loc_1',
        ratePerHour: 280,
      ),
      Employee(
        id: 'emp_4',
        name: 'Ксюша',
        role: 'junior',
        locationId: 'loc_1',
        ratePerHour: 280,
      ),
      Employee(
        id: 'emp_admin',
        name: 'Директор',
        role: 'admin',
        locationId: 'loc_1',
        ratePerHour: 0,
      ),
    ];
  }

  static CleaningRule getCleaningRule() {
    return CleaningRule(
      locationId: 'loc_1',
      daysOfWeek: [1, 3, 4, 5, 7], // Пн, Ср, Чт, Пт, Вс
      appliesToSlot: 'evening',
      cleaningRate: 400,
    );
  }

  static List<ExtraClassType> getExtraClassTypes() {
    return [
      ExtraClassType(
        id: 'extra_1',
        locationId: 'loc_1',
        name: 'Английский',
        ratePerChild: 200,
        active: true,
      ),
      ExtraClassType(
        id: 'extra_2',
        locationId: 'loc_1',
        name: 'Лексикодия',
        ratePerChild: 200,
        active: true,
      ),
    ];
  }

  static Week getCurrentWeek() {
    // 12-18 января 2025 (понедельник)
    final startDate = DateTime(2025, 1, 12);
    return Week(
      id: 'week_1',
      locationId: 'loc_1',
      startDate: startDate,
    );
  }

  static List<Shift> getShifts() {
    final week = getCurrentWeek();
    final shifts = <Shift>[];
    final dates = [
      '2025-01-12', // Пн
      '2025-01-13', // Вт
      '2025-01-14', // Ср
      '2025-01-15', // Чт
      '2025-01-16', // Пт
      '2025-01-17', // Сб
      '2025-01-18', // Вс
    ];

    int shiftId = 1;
    for (final date in dates) {
      final dateObj = DateTime.parse(date);
      final weekday = dateObj.weekday; // 1=Monday
      final cleaningRule = getCleaningRule();
      final cleaningPlanned = cleaningRule.daysOfWeek.contains(weekday);

      // Morning shift
      shifts.add(Shift(
        id: 'shift_${shiftId++}',
        weekId: week.id,
        locationId: 'loc_1',
        date: date,
        slot: 'morning',
        shiftType: 'normal',
        hours: 5.0,
        cleaningPlanned: false,
        cleaningConfirmed: false,
        actualEmployeeId: shiftId % 2 == 0 ? 'emp_1' : 'emp_2',
      ));

      // Evening shift
      shifts.add(Shift(
        id: 'shift_${shiftId++}',
        weekId: week.id,
        locationId: 'loc_1',
        date: date,
        slot: 'evening',
        shiftType: weekday == 3 ? 'replacement' : 'normal', // Ср - замена
        hours: 7.0,
        cleaningPlanned: cleaningPlanned,
        cleaningConfirmed: weekday == 1 || weekday == 3, // Пн и Ср подтверждены
        actualEmployeeId: weekday == 3 ? 'emp_3' : 'emp_1',
        cleaningRecordId: (weekday == 1 || weekday == 3) ? 'clean_${weekday}' : null,
      ));
    }

    return shifts;
  }

  static List<CleaningRecord> getCleaningRecords() {
    return [
      CleaningRecord(
        id: 'clean_1',
        locationId: 'loc_1',
        dateFor: '2025-01-12', // Пн
        performedByEmployeeId: 'emp_1',
        createdAt: DateTime(2025, 1, 12, 20, 0),
        flagged: false,
      ),
      CleaningRecord(
        id: 'clean_3',
        locationId: 'loc_1',
        dateFor: '2025-01-14', // Ср
        performedByEmployeeId: 'emp_3',
        createdAt: DateTime(2025, 1, 14, 20, 0),
        flagged: false,
      ),
    ];
  }

  static List<ExtraClassRecord> getExtraClassRecords() {
    return [
      ExtraClassRecord(
        id: 'extra_rec_1',
        locationId: 'loc_1',
        shiftId: 'shift_2', // Пн вечер
        date: '2025-01-12',
        employeeId: 'emp_1',
        extraClassTypeId: 'extra_1',
        childrenCount: 8,
        ratePerChildSnapshot: 200,
        amount: 1600,
        createdAt: DateTime(2025, 1, 12, 18, 0),
        flagged: false,
      ),
      ExtraClassRecord(
        id: 'extra_rec_2',
        locationId: 'loc_1',
        shiftId: 'shift_4', // Вт вечер
        date: '2025-01-13',
        employeeId: 'emp_2',
        extraClassTypeId: 'extra_2',
        childrenCount: 6,
        ratePerChildSnapshot: 200,
        amount: 1200,
        createdAt: DateTime(2025, 1, 13, 18, 0),
        flagged: false,
      ),
    ];
  }
}
