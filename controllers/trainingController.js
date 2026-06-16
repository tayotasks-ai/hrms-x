import { TrainingCourse } from '../models/TrainingCourse.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { trainingEnrolled } from '../utils/emailTemplates.js';

export const getTrainingCourses = async (req, res) => {
  try {
    const courses = await TrainingCourse.find({ tenantId: req.tenantId })
      .populate('enrollments.employeeId', 'firstName lastName department positionId');
      
    res.json({ success: true, data: courses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createTrainingCourse = async (req, res) => {
  try {
    const { title, description, type, isMandatory, provider, durationHours, cost } = req.body;
    
    const newCourse = new TrainingCourse({
      tenantId: req.tenantId,
      title,
      description,
      type,
      isMandatory,
      provider,
      durationHours,
      cost
    });

    await newCourse.save();
    res.status(201).json({ success: true, data: newCourse });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const enrollEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, status } = req.body; // status can be 'Enrolled' or 'Requested'

    const course = await TrainingCourse.findOne({ _id: id, tenantId: req.tenantId });
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
    
    const alreadyEnrolled = course.enrollments.some(e => e.employeeId.toString() === employeeId);
    if (alreadyEnrolled) return res.status(400).json({ success: false, message: 'Already enrolled/requested' });

    course.enrollments.push({ employeeId, status: status || 'Enrolled' });
    await course.save();

    // Fire-and-forget – notify employee
    Employee.findById(employeeId).select('name email').lean()
      .then(emp => {
        if (emp?.email) {
          const tpl = trainingEnrolled({
            employeeName: emp.name,
            courseTitle: course.title,
            courseType: course.type,
            durationHours: course.durationHours,
          });
          sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
        }
      })
      .catch(err => console.error('Email lookup failed:', err.message));

    res.json({ success: true, data: course });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const updateEnrollmentStatus = async (req, res) => {
  try {
    const { id, enrollmentId } = req.params;
    const { status, progressPercentage } = req.body;

    const course = await TrainingCourse.findOne({ _id: id, tenantId: req.tenantId });
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const enrollment = course.enrollments.id(enrollmentId);
    if (!enrollment) return res.status(404).json({ success: false, message: 'Enrollment not found' });

    if (status) enrollment.status = status;
    if (progressPercentage !== undefined) enrollment.progressPercentage = progressPercentage;
    if (status === 'Completed') enrollment.completionDate = new Date();

    await course.save();
    res.json({ success: true, data: course });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
