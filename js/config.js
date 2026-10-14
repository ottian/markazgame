// إعدادات المركز والفريق — عدّل هنا براحتك
// الصور: حط صورة كل موظف في مجلد assets/staff واكتب اسم الملف في photo
// (لو photo = null هيظهر أول حرف من الاسم بدل الصورة)

export const CONFIG = {
  centerName: 'المركز الاستشاري للطب النفسي وعلاج الإدمان',
  centerShort: 'المركز الاستشاري',
  hotline: '',

  staff: [
    { id: 'driver1', name: 'خالد رضا', role: 'driver', title: 'سواق عربية الإحضار', photo: null },
    { id: 'driver2', name: 'احمد عمرو', role: 'driver', title: 'سواق عربية الإحضار', photo: null },
    { id: 'doctor1', name: 'الدكتور', role: 'doctor', title: 'طبيب نفسي', photo: null },
    { id: 'nurse1', name: 'محمد الحلواني', role: 'nurse', title: 'تمريض', photo: null },
    { id: 'social1', name: 'الأخصائي', role: 'social', title: 'أخصائي نفسي/اجتماعي', photo: null },
  ],

  // ---------- وضع إسكندرية الحقيقية (مباني جوجل 3D) ----------
  // حط مفتاح Google Maps API (لازم يكون مفعّل عليه Map Tiles API)
  // واقفله على الدومين بتاعك من Google Cloud Console (HTTP referrers)
  googleMapsApiKey: 'AIzaSyBfFuKLmpspUp6i8Vvuq4c5kCiWhJ8ynGE',

  real: {
    // مكان المركز (من جوجل ماب)
    center: { lat: 31.229128, lon: 29.958118 },
    // أماكن البلاغات (إحداثيات تقريبية)
    landmarks: [
      { name: 'محطة الرمل', short: 'الرمل', lat: 31.2003, lon: 29.9010 },
      { name: 'مكتبة الإسكندرية', short: 'المكتبة', lat: 31.2089, lon: 29.9092 },
      { name: 'قلعة قايتباي', short: 'القلعة', lat: 31.2140, lon: 29.8855 },
      { name: 'المنشية', short: 'المنشية', lat: 31.1985, lon: 29.8945 },
      { name: 'عمود السواري', short: 'كرموز', lat: 31.1825, lon: 29.8965 },
      { name: 'الشاطبي', short: 'الشاطبي', lat: 31.2120, lon: 29.9200 },
      { name: 'سيدي جابر', short: 'سيدي جابر', lat: 31.2190, lon: 29.9425 },
      { name: 'كوبري ستانلي', short: 'ستانلي', lat: 31.2355, lon: 29.9490 },
      { name: 'سان ستيفانو', short: 'سان ستيفانو', lat: 31.2450, lon: 29.9655 },
      { name: 'سيدي بشر', short: 'سيدي بشر', lat: 31.2600, lon: 29.9860 },
      { name: 'ميامي', short: 'ميامي', lat: 31.2695, lon: 29.9995 },
      { name: 'المندرة', short: 'المندرة', lat: 31.2800, lon: 30.0110 },
      { name: 'قصر المنتزه', short: 'المنتزه', lat: 31.2885, lon: 30.0160 },
    ],
  },

  // ---------- شخصيات واقعية (اختياري) ----------
  // حمّل شخصيات من Mixamo (FBX) أو أي GLB متحرك وحطها في assets/people
  // اقرا assets/people/README.md — لو الليستة فاضية بتشتغل الشخصيات البسيطة
  characters: {
    models: [], // مثال: ['man1.fbx', 'woman1.fbx']
    walk: '', // أنيميشن المشي (In Place) مثال: 'walking.fbx'
    idle: '', // أنيميشن الوقوف مثال: 'idle.fbx'
    scale: 0.01, // Mixamo بالسنتيمتر → 0.01
    doctor: '', nurse: '', patient: '', // موديلات خاصة للفريق والحالة (اختياري)
  },

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
