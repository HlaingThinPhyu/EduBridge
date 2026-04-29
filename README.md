# EduBridge

A modern, full-stack educational platform designed to bridge the gap between students and quality learning resources. EduBridge provides an intuitive interface for accessing lessons, tracking progress, and supporting offline learning experiences.

## Overview

EduBridge is an educational management system that enables educators to create and manage lessons, and allows students to learn at their own pace with comprehensive progress tracking. The platform supports multiple languages and difficulty levels, with built-in offline functionality for uninterrupted learning.

## Key Features

- **Lesson Management**: Create, update, and organize lessons with rich content support
- **User Tracking**: Monitor student progress with detailed completion statistics
- **File & Video Support**: Upload and manage lesson materials and video content
- **Offline Access**: Download materials for offline learning with automatic sync when online
- **Multi-language Support**: Lessons available in multiple languages with customizable locales
- **Responsive Design**: Works seamlessly across desktop and mobile devices
- **Progress Analytics**: View comprehensive statistics on lesson completion rates

## Tech Stack

### Frontend
- **JavaScript** (55.4%) - Core frontend logic
- **HTML** (15.4%) - Markup and structure
- **CSS** (12.1%) - Styling and responsive design

### Backend
- **Python** (17.1%) - Server-side logic
- **FastAPI** - Modern, fast web framework for building APIs
- **PyMongo** - MongoDB driver for database operations
- **GridFS** - MongoDB file storage for lesson materials and videos

### Database
- **MongoDB** - NoSQL database for flexible data storage and management

### Infrastructure
- **CORS Middleware** - Cross-origin resource sharing support
- **Static File Serving** - Serve frontend assets and static content

## Architecture

EduBridge follows a client-server architecture with:
- **Frontend**: Static web application served through FastAPI
- **Backend**: RESTful API built with FastAPI for all business logic
- **Database**: MongoDB for persistent data storage with GridFS for large files

## Getting Started

The project is structured as:
EduBridge/ ├── edubridge_ProjectSourceCode/ │ ├── Backend/ │ │ └── main.py │ └── ... ├── static/ │ └── dashboard.html └── README.md


## Installation & Setup

1. Install Python dependencies
2. Configure MongoDB URI in environment variables
3. Run the FastAPI backend server
4. Access the application through the provided dashboard

## API Endpoints

The backend provides RESTful endpoints for:
- User management (create, list users)
- Lesson management (CRUD operations)
- Progress tracking (record and sync learning progress)
- File operations (upload and download lesson materials)
- Statistics (view completion rates and analytics)



This project is part of the Advance Topic in DBMS course.
