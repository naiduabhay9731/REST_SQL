const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require("cors");
require("dotenv").config();
app.use(cors());
const mysql = require("mysql2/promise");
const hst = process.env.HST;
const pwd = process.env.PWD;
const usr = process.env.USR;

app.use(express.json());

const pool = mysql.createPool({
  host: hst,
  user: usr,
  password: pwd,
  database: "Employee1",
});

const createEmployeeTable = `
  CREATE TABLE IF NOT EXISTS Employee (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    job_title VARCHAR(255) NOT NULL,
    phone_number VARCHAR(15),
    email VARCHAR(255),
    address VARCHAR(255),
    city VARCHAR(50),
    state VARCHAR(50)
  )
`;

const createETable = `
  CREATE TABLE IF NOT EXISTS EmergencyContact (
    id INT AUTO_INCREMENT PRIMARY KEY,
    primary_emergency_contact VARCHAR(255) NOT NULL,
    emergency_contact_phone VARCHAR(15),
    relationship VARCHAR(50),
    employee_id INT,
   
    FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
  )
`;

const createSETable = `
  CREATE TABLE IF NOT EXISTS SecondaryEmergencyContact (
    id INT AUTO_INCREMENT PRIMARY KEY,
    secondary_emergency_contact VARCHAR(255) NOT NULL,
    s_emergency_contact_phone VARCHAR(15),
    s_relationship VARCHAR(50),
    employee_id INT,
    FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
  )
`;

const tableCreationQueries = [createEmployeeTable, createETable, createSETable];

(async () => {
  const connection = await pool.getConnection();

  for (const query of tableCreationQueries) {
    try {
      await connection.query(query);
      console.log(`Table created successfully: ${query}`);
    } catch (err) {
      console.error(`Error creating table: ${query}\n`, err);
    }
  }

  connection.release();
})();

app
  .route("/employees")
  .get(async function (req, res) {
    try {
      const connection = await pool.getConnection();

      // Get pagination parameters from the query string
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10; // You can adjust the default page size

      // Calculate the offset for the SQL query
      const offset = (page - 1) * pageSize;

      // Query all employees with pagination and their related emergency and secondary emergency contacts
      const [rows] = await connection.query(
        "SELECT e.*, ec.*, sec.* FROM Employee e " +
          "LEFT JOIN EmergencyContact ec ON e.id = ec.employee_id " +
          "LEFT JOIN SecondaryEmergencyContact sec ON e.id = sec.employee_id " +
          "LIMIT ? OFFSET ?",
        [pageSize, offset]
      );

      connection.release();

      // Organize the data into employee objects with contact information
      const employees = {};

      rows.forEach((row) => {
        if (!employees[row.id]) {
          employees[row.id] = {
            id: row.id,
            name: row.name,
            job_title: row.job_title,
            phone_number: row.phone_number,
            email: row.email,
            address: row.address,
            city: row.city,
            state: row.state,
            emergency_contacts: [],
            secondary_emergency_contacts: [],
          };
        }

        if (row.primary_emergency_contact) {
          employees[row.id].emergency_contacts.push({
            id: row.ec_id,
            primary_emergency_contact: row.primary_emergency_contact,
            emergency_contact_phone: row.emergency_contact_phone_number,
            relationship: row.relationship,
          });
        }

        if (row.secondary_emergency_contact) {
          employees[row.id].secondary_emergency_contacts.push({
            id: row.sec_id,
            secondary_emergency_contact: row.secondary_emergency_contact,
            s_emergency_contact_phone: row.s_emergency_contact_phone_number,
            s_relationship: row.s_relationship,
          });
        }
      });

      res.json(Object.values(employees));
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error" });
    }
  })
  .post(async function (req, res) {
    try {
      const {
        name,
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts,
        secondary_emergency_contacts,
      } = req.body;
      console.log(secondary_emergency_contacts);

      const connection = await pool.getConnection();

      // Insert the new employee data
      const [employeeResult] = await connection.query(
        "INSERT INTO Employee (name, job_title, phone_number, email, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, job_title, phone_number, email, address, city, state]
      );

      const employeeId = employeeResult.insertId;

      // Insert the new emergency contacts
      for (const emergencyContact of emergency_contacts) {
        const {
          primary_emergency_contact,
          emergency_contact_phone,
          relationship,
        } = emergencyContact;
        await connection.query(
          "INSERT INTO EmergencyContact (primary_emergency_contact, emergency_contact_phone, relationship, employee_id) VALUES (?, ?, ?, ?)",
          [
            primary_emergency_contact,
            emergency_contact_phone,
            relationship,
            employeeId,
          ]
        );
      }

      // Insert the new secondary emergency contacts
      for (const secondaryEmergencyContact of secondary_emergency_contacts) {
        const {
          secondary_emergency_contact,
          s_emergency_contact_phone,
          s_relationship,
        } = secondaryEmergencyContact;
        await connection.query(
          "INSERT INTO SecondaryEmergencyContact (secondary_emergency_contact, s_emergency_contact_phone, s_relationship, employee_id) VALUES (?, ?, ?, ?)",
          [
            secondary_emergency_contact,
            s_emergency_contact_phone,
            s_relationship,
            employeeId,
          ]
        );
      }

      connection.release();
      res.status(201).json({
        id: employeeId,
        name,
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error" });
    }
  })
  .delete(async function (req, res) {
    try {
      const connection = await pool.getConnection();

      // Start a transaction to ensure data consistency
      await connection.beginTransaction();

      try {
        // Delete all employee entries in the Employee table
        const [deleteResult] = await connection.query("DELETE FROM Employee");

        // Commit the transaction
        await connection.commit();

        res.json({ message: "All employees deleted successfully" });
      } catch (error) {
        // Rollback the transaction in case of an error
        await connection.rollback();
        throw error;
      } finally {
        // Release the connection
        connection.release();
      }
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

app
  .route("/employees/:name")
  .get(async (req, res) => {
    try {
      const name2 = req.params.name; // Get the name from the URL parameter

      const connection = await pool.getConnection();

      // Query the employee's information and their related emergency and secondary emergency contacts
      const [rows] = await connection.query(
        "SELECT e.*, ec.*, sec.* FROM Employee e " +
          "LEFT JOIN EmergencyContact ec ON e.id = ec.employee_id " +
          "LEFT JOIN SecondaryEmergencyContact sec ON e.id = sec.employee_id " +
          "WHERE e.name = ?",
        [name2]
      );
      
      connection.release();
      const { name, job_title, phone_number, email, address, city, state } =rows[0];
      
      const employee = {
        name,
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts: [],
        secondary_emergency_contacts: [],
      };

      rows.forEach((row) => {
        if (row.primary_emergency_contact) {
          employee.emergency_contacts.push({
            id: row.ec_id,
            primary_emergency_contact: row.primary_emergency_contact,
            emergency_contact_phone_number: row.emergency_contact_phone_number,
            relationship: row.relationship,
          });
        }

        if (row.secondary_emergency_contact) {
          employee.secondary_emergency_contacts.push({
            id: row.sec_id,
            secondary_emergency_contact: row.secondary_emergency_contact,
            s_emergency_contact_phone_number:
              row.s_emergency_contact_phone_number,
            s_relationship: row.s_relationship,
          });
        }
      });

      if (
        employee.emergency_contacts.length === 0 &&
        employee.secondary_emergency_contacts.length === 0
      ) {
        // If there are no matching entries, respond with a 404 status
        res.status(404).json({ message: "Employee not found" });
      } else {
        res.json(employee);
      }
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  })
  .put(async (req, res) => {
    try {
      const name = req.params.name; // Get the name from the URL parameter
      const {
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts,
        secondary_emergency_contacts,
      } = req.body;

      const connection = await pool.getConnection();

      // Start a transaction to ensure data consistency
      await connection.beginTransaction();

      try {
        // Update the employee's information based on the provided name
        await connection.query(
          "UPDATE Employee SET job_title = ?, phone_number = ?, email = ?, address = ?, city = ?, state = ? WHERE name = ?",
          [job_title, phone_number, email, address, city, state, name]
        );

        // Delete existing emergency contacts for the employee
        await connection.query(
          "DELETE FROM EmergencyContact WHERE employee_id IN (SELECT id FROM Employee WHERE name = ?)",
          [name]
        );

        // Insert the new emergency contacts
        for (const emergencyContact of emergency_contacts) {
          const {
            primary_emergency_contact,
            emergency_contact_phone,
            relationship,
          } = emergencyContact;
          await connection.query(
            "INSERT INTO EmergencyContact (primary_emergency_contact, emergency_contact_phone, relationship, employee_id) " +
              "VALUES (?, ?, ?, (SELECT id FROM Employee WHERE name = ?))",
            [
              primary_emergency_contact,
              emergency_contact_phone,
              relationship,
              name,
            ]
          );
        }

        // Delete existing secondary emergency contacts for the employee
        await connection.query(
          "DELETE FROM SecondaryEmergencyContact WHERE employee_id IN (SELECT id FROM Employee WHERE name = ?)",
          [name]
        );

        // Insert the new secondary emergency contacts
        for (const secondaryEmergencyContact of secondary_emergency_contacts) {
          const {
            secondary_emergency_contact,
            s_emergency_contact_phone,
            s_relationship,
          } = secondaryEmergencyContact;
          await connection.query(
            "INSERT INTO SecondaryEmergencyContact (secondary_emergency_contact, s_emergency_contact_phone, s_relationship, employee_id) " +
              "VALUES (?, ?, ?, (SELECT id FROM Employee WHERE name = ?))",
            [
              secondary_emergency_contact,
              s_emergency_contact_phone,
              s_relationship,
              name,
            ]
          );
        }

        // Commit the transaction
        await connection.commit();
      } catch (error) {
        // Rollback the transaction in case of an error
        await connection.rollback();
        throw error;
      } finally {
        // Release the connection
        connection.release();
      }

      res.json({
        name,
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts,
        secondary_emergency_contacts,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Internal server error" });
    }
  })
  .patch(async (req, res) => {
    try {
      const name = req.params.name; // Get the name from the URL parameter
      const {
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts,
        secondary_emergency_contacts,
      } = req.body;

      const connection = await pool.getConnection();

      // Start a transaction to ensure data consistency
      await connection.beginTransaction();

      try {
        // Update the employee's information based on the provided name
        await connection.query(
          "UPDATE Employee SET job_title = ?, phone_number = ?, email = ?, address = ?, city = ?, state = ? WHERE name = ?",
          [job_title, phone_number, email, address, city, state, name]
        );

        // Delete existing emergency contacts for the employee
        await connection.query(
          "DELETE FROM EmergencyContact WHERE employee_id IN (SELECT id FROM Employee WHERE name = ?)",
          [name]
        );

        // Insert the new emergency contacts
        for (const emergencyContact of emergency_contacts) {
          const {
            primary_emergency_contact,
            emergency_contact_phone,
            relationship,
          } = emergencyContact;
          await connection.query(
            "INSERT INTO EmergencyContact (primary_emergency_contact, emergency_contact_phone, relationship, employee_id) " +
              "VALUES (?, ?, ?, (SELECT id FROM Employee WHERE name = ?))",
            [
              primary_emergency_contact,
              emergency_contact_phone,
              relationship,
              name,
            ]
          );
        }

        // Delete existing secondary emergency contacts for the employee
        await connection.query(
          "DELETE FROM SecondaryEmergencyContact WHERE employee_id IN (SELECT id FROM Employee WHERE name = ?)",
          [name]
        );

        // Insert the new secondary emergency contacts
        for (const secondaryEmergencyContact of secondary_emergency_contacts) {
          const {
            secondary_emergency_contact,
            s_emergency_contact_phone,
            s_relationship,
          } = secondaryEmergencyContact;
          await connection.query(
            "INSERT INTO SecondaryEmergencyContact (secondary_emergency_contact, s_emergency_contact_phone, s_relationship, employee_id) " +
              "VALUES (?, ?, ?, (SELECT id FROM Employee WHERE name = ?))",
            [
              secondary_emergency_contact,
              s_emergency_contact_phone,
              s_relationship,
              name,
            ]
          );
        }

        // Commit the transaction
        await connection.commit();
      } catch (error) {
        // Rollback the transaction in case of an error
        await connection.rollback();
        throw error;
      } finally {
        // Release the connection
        connection.release();
      }

      res.json({
        name,
        job_title,
        phone_number,
        email,
        address,
        city,
        state,
        emergency_contacts,
        secondary_emergency_contacts,
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  })

  .delete(async (req, res) => {
    try {
      const name = req.params.name; // Get the name from the URL parameter

      const connection = await pool.getConnection();

      // Start a transaction to ensure data consistency
      await connection.beginTransaction();

      try {
        // Delete the employee entry with the provided name
        const [deleteResult] = await connection.query(
          "DELETE FROM Employee WHERE name = ?",
          [name]
        );

        // Check if any rows were affected by the delete operation
        if (deleteResult.affectedRows === 0) {
          // If no rows were affected, the employee with that name doesn't exist
          res.status(404).json({ message: "Employee not found" });
        } else {
          // Commit the transaction
          await connection.commit();
          res.json({ message: "Employee deleted successfully" });
        }
      } catch (error) {
        // Rollback the transaction in case of an error
        await connection.rollback();
        throw error;
      } finally {
        // Release the connection
        connection.release();
      }
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

app.listen(5000, function () {
  console.log("Server started on port 3000");
});
