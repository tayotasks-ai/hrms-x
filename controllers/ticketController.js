import HelpdeskTicket from '../models/HelpdeskTicket.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { ticketReply } from '../utils/emailTemplates.js';

export const getTickets = async (req, res) => {
  try {
    const tickets = await HelpdeskTicket.find({ tenantId: req.tenantId })
      .populate('employeeId', 'name role department email status')
      .populate('assignedTo', 'name role')
      .populate('messages.sender', 'name role')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createTicket = async (req, res) => {
  try {
    const { employeeId, subject, description, category, priority } = req.body;
    
    const newTicket = new HelpdeskTicket({
      tenantId: req.tenantId,
      employeeId,
      subject,
      description,
      category,
      priority
    });

    const saved = await newTicket.save();
    
    const populated = await HelpdeskTicket.findById(saved._id)
      .populate('employeeId', 'name role department')
      .populate('assignedTo', 'name');
      
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedTo } = req.body;

    const ticket = await HelpdeskTicket.findOne({ _id: id, tenantId: req.tenantId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    if (status) ticket.status = status;
    if (assignedTo !== undefined) ticket.assignedTo = assignedTo || null; // Allow unassigning

    await ticket.save();
    
    const populated = await HelpdeskTicket.findById(ticket._id)
      .populate('employeeId', 'name role department email status')
      .populate('assignedTo', 'name role')
      .populate('messages.sender', 'name role');

    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const addMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    const ticket = await HelpdeskTicket.findOne({ _id: id, tenantId: req.tenantId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    ticket.messages.push({
      sender: req.user._id,
      message
    });

    await ticket.save();
    
    const populated = await HelpdeskTicket.findById(ticket._id)
      .populate('employeeId', 'name role department email status')
      .populate('assignedTo', 'name role email')
      .populate('messages.sender', 'name role');

    // Fire-and-forget – notify the other party
    const senderId = req.user._id.toString();
    const empId = populated.employeeId?._id?.toString();
    let recipientEmail, recipientName;
    if (senderId === empId && populated.assignedTo?.email) {
      // Employee replied – notify assigned HR
      recipientEmail = populated.assignedTo.email;
      recipientName = populated.assignedTo.name;
    } else if (populated.employeeId?.email) {
      // HR replied – notify employee
      recipientEmail = populated.employeeId.email;
      recipientName = populated.employeeId.name;
    }
    if (recipientEmail) {
      const tpl = ticketReply({
        recipientName,
        ticketSubject: ticket.subject,
        senderName: req.user.name || 'Someone',
        messageSnippet: message.length > 200 ? message.substring(0, 200) + '…' : message,
      });
      sendEmail({ to: recipientEmail, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
