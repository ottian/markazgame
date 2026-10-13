// إعدادات المركز والفريق — عدّل هنا براحتك
// الصور: حط صورة كل موظف في مجلد assets/staff واكتب اسم الملف في photo
// (لو photo = null هيظهر أول حرف من الاسم بدل الصورة)

export const CONFIG = {
  centerName: 'المركز الاستشاري للطب النفسي وعلاج الإدمان',
  centerShort: 'المركز الاستشاري',
  hotline: '',

  staff: [
    { id: 'driver1', name: 'السواق ١', role: 'driver', title: 'سواق عربية الإحضار', photo: null },
    { id: 'driver2', name: 'السواق ٢', role: 'driver', title: 'سواق عربية الإحضار', photo: null },
    { id: 'doctor1', name: 'الدكتور', role: 'doctor', title: 'طبيب نفسي', photo: null },
    { id: 'nurse1', name: 'الممرض', role: 'nurse', title: 'تمريض', photo: null },
    { id: 'social1', name: 'الأخصائي', role: 'social', title: 'أخصائي نفسي/اجتماعي', photo: null },
  ],

  // أنواع البلاغات — بدون أي بيانات لمرضى حقيقيين
  cases: [
    { text: 'الأسرة طالبة تقييم نفسي عاجل لابنهم', calm: 4.5 },
    { text: 'حالة انسحاب من المخدرات ومحتاجة نقل هادي للمركز', calm: 5 },
    { text: 'مريض متابع عندنا ومحتاج دخول للعلاج', calm: 3.5 },
    { text: 'حالة قلق وتوتر شديد — الأسرة قلقانة', calm: 4 },
    { text: 'نقل مريض من بيته لبدء برنامج علاج الإدمان', calm: 4 },
    { text: 'استشارة طارئة — المريض موافق ييجي المركز', calm: 3 },
  ],
};
