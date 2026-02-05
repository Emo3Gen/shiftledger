import 'package:intl/intl.dart';

class DateUtils {
  static String formatDate(String dateStr) {
    final date = DateTime.parse(dateStr);
    return DateFormat('dd.MM', 'ru').format(date);
  }

  static String formatDateFull(String dateStr) {
    final date = DateTime.parse(dateStr);
    return DateFormat('EEEE, d MMMM', 'ru').format(date);
  }

  static String formatWeekday(String dateStr) {
    final date = DateTime.parse(dateStr);
    final weekday = date.weekday;
    final weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return weekdays[weekday - 1];
  }

  static String formatSlot(String slot) {
    return slot == 'morning' ? 'Утро' : 'Вечер';
  }

  static String formatShiftType(String type) {
    switch (type) {
      case 'normal':
        return 'Обычная';
      case 'replacement':
        return 'Замена';
      case 'training':
        return 'Обучение';
      default:
        return type;
    }
  }

  static List<String> getWeekDates(DateTime startDate) {
    final dates = <String>[];
    for (int i = 0; i < 7; i++) {
      final date = startDate.add(Duration(days: i));
      dates.add(DateFormat('yyyy-MM-dd').format(date));
    }
    return dates;
  }

  static bool isDateInWeek(String dateStr, DateTime weekStart) {
    final date = DateTime.parse(dateStr);
    final weekEnd = weekStart.add(const Duration(days: 6));
    return date.isAfter(weekStart.subtract(const Duration(days: 1))) &&
           date.isBefore(weekEnd.add(const Duration(days: 1)));
  }
}
