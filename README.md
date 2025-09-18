# New_HMS
create database hms_group;
use hms_group;
create table branch
(
    branch_id   int auto_increment
        primary key,
    branch_name varchar(20)              null,
    location    varchar(20)              null,
    phone       varchar(10)              null,
    created_at  datetime default (now()) null
);

create table patient
(
    patient_id        int auto_increment
        primary key,
    first_name        varchar(25)                      null,
    last_name         varchar(25)                      null,
    date_of_birth     date                             null,
    gender            enum ('Male', 'Female', 'Other') null,
    phone             varchar(10)                      null,
    email             varchar(50)                      null,
    address           text                             null,
    emergency_contact varchar(10)                      null,
    created_at        datetime default (now())         null,
    updated_at        datetime default (now())         null
);

create table insurance_policy
(
    policy_id           int auto_increment
        primary key,
    patient_id          int                          null,
    provider_name       varchar(25)                  null,
    policy_number       varchar(10)                  null,
    coverage_percentage decimal(5, 2)                null,
    deductable          decimal(10, 2)               null,
    expiry_date         date     default (curdate()) null,
    is_active           tinyint(1)                   null,
    created_at          datetime default (now())     null,
    constraint insurance_policy_ibfk_1
        foreign key (patient_id) references patient (patient_id)
);

create index patient_id
    on insurance_policy (patient_id);

create table staff
(
    staff_id   int auto_increment
        primary key,
    first_name varchar(25)                                                null,
    last_name  varchar(25)                                                null,
    role       enum ('Admin', 'Doctor', 'Nurse', 'Receptionist', 'Other') not null,
    speciality varchar(25)                                                null,
    email      varchar(50)                                                null,
    branch_id  int                                                        null,
    created_at datetime default CURRENT_TIMESTAMP                         null,
    is_active  tinyint(1)                                                 null,
    password   varchar(255)                                               not null,
    constraint staff_ibfk_1
        foreign key (branch_id) references branch (branch_id)
);

create table appointment
(
    appointment_id   int auto_increment
        primary key,
    patient_id       int                                          null,
    doctor_id        int                                          null,
    branch_id        int                                          null,
    appointment_date date                                         null,
    appointment_time time                                         null,
    status           enum ('Scheduled', 'Completed', 'Cancelled') null,
    created_at       datetime default (now())                     null,
    updated_at       datetime default (now())                     null,
    constraint appointment_ibfk_1
        foreign key (patient_id) references patient (patient_id),
    constraint appointment_ibfk_2
        foreign key (doctor_id) references staff (staff_id),
    constraint appointment_ibfk_3
        foreign key (branch_id) references branch (branch_id)
);

create index branch_id
    on appointment (branch_id);

create index doctor_id
    on appointment (doctor_id);

create index patient_id
    on appointment (patient_id);

create table appointment_history
(
    history_id      int auto_increment
        primary key,
    appointment_id  int                                          null,
    previous_status enum ('Scheduled', 'Completed', 'Cancelled') null,
    new_status      enum ('Scheduled', 'Completed', 'Cancelled') null,
    reason          text                                         null,
    modified_by     int                                          null,
    modified_at     datetime default (now())                     null,
    constraint appointment_history_ibfk_1
        foreign key (appointment_id) references appointment (appointment_id),
    constraint appointment_history_ibfk_2
        foreign key (modified_by) references staff (staff_id)
);

create index appointment_id
    on appointment_history (appointment_id);

create index modified_by
    on appointment_history (modified_by);

create table audit_log
(
    log_id         bigint auto_increment
        primary key,
    staff_id       int                                 null,
    table_name     varchar(25)                         null,
    operation_type enum ('INSERT', 'UPDATE', 'DELETE') null,
    record_id      int                                 null,
    timestamp      datetime                            null,
    ip_address     varchar(61)                         null,
    old_values     json                                null,
    new_values     json                                null,
    constraint audit_log_ibfk_1
        foreign key (staff_id) references staff (staff_id)
);

create index staff_id
    on audit_log (staff_id);

create table invoice
(
    invoice_id       int auto_increment
        primary key,
    patient_id       int                                   null,
    appointment_id   int                                   null,
    total_amount     decimal(10, 2)                        null,
    insurance_amount decimal(10, 2)                        null,
    patient_amount   decimal(10, 2)                        null,
    status           enum ('Pending', 'Paid', 'Cancelled') null,
    created_at       datetime default (now())              null,
    due_date         datetime default (now())              null,
    constraint invoice_ibfk_1
        foreign key (patient_id) references patient (patient_id),
    constraint invoice_ibfk_2
        foreign key (appointment_id) references appointment (appointment_id)
);

create table insurance_claim
(
    claim_id             int auto_increment
        primary key,
    invoice_id           int                                        null,
    policy_id            int                                        null,
    claim_amount         decimal(10, 2)                             null,
    submission_date      date     default (now())                   null,
    claim_status         enum ('Submitted', 'Approved', 'Rejected') null,
    reimbursement_amount decimal(10, 2)                             null,
    denial_reason        text                                       null,
    created_at           datetime default (now())                   null,
    constraint insurance_claim_ibfk_1
        foreign key (invoice_id) references invoice (invoice_id),
    constraint insurance_claim_ibfk_2
        foreign key (policy_id) references insurance_policy (policy_id)
);

create index invoice_id
    on insurance_claim (invoice_id);

create index policy_id
    on insurance_claim (policy_id);

create index appointment_id
    on invoice (appointment_id);

create index patient_id
    on invoice (patient_id);

create table payment
(
    payment_id            int auto_increment
        primary key,
    invoice_id            int                                          null,
    payment_date          datetime                                     null,
    amount                decimal(10, 2)                               null,
    payment_method        enum ('Cash', 'Card', 'Insurance', 'Online') null,
    transaction_reference varchar(25)                                  null,
    status                enum ('Pending', 'Paid', 'Cancelled')        null,
    notes                 text                                         null,
    constraint payment_ibfk_1
        foreign key (invoice_id) references invoice (invoice_id)
);

create index invoice_id
    on payment (invoice_id);

create index branch_id
    on staff (branch_id);

create table staff_branch_access
(
    access_id    int auto_increment
        primary key,
    staff_id     int                                      null,
    branch_id    int                                      null,
    access_level enum ('Read', 'Write', 'Admin', 'Owner') null,
    granted_at   datetime default (now())                 null,
    is_active    tinyint(1)                               null,
    constraint staff_branch_access_ibfk_1
        foreign key (staff_id) references staff (staff_id),
    constraint staff_branch_access_ibfk_2
        foreign key (branch_id) references branch (branch_id)
);

create index branch_id
    on staff_branch_access (branch_id);

create index staff_id
    on staff_branch_access (staff_id);

create table treatment_catalogue
(
    treatment_type_id int auto_increment
        primary key,
    treatment_name    varchar(25)    null,
    description       text           null,
    icd10_code        varchar(7)     null,
    cpt_code          varchar(5)     null,
    standard_cost     decimal(10, 2) null,
    category          varchar(25)    null,
    is_active         tinyint(1)     null
);

create table treatment
(
    treatment_id       int auto_increment
        primary key,
    appointment_id     int                                null,
    treatment_type_id  int                                null,
    consultation_notes text                               null,
    prescription       text                               null,
    treatment_date     datetime default CURRENT_TIMESTAMP null,
    cost               decimal(10, 2)                     null,
    doctor_signature   text                               null,
    created_at         datetime default (now())           null,
    constraint treatment_ibfk_1
        foreign key (appointment_id) references appointment (appointment_id),
    constraint treatment_ibfk_2
        foreign key (treatment_type_id) references treatment_catalogue (treatment_type_id)
);

create index appointment_id
    on treatment (appointment_id);

create index treatment_type_id
    on treatment (treatment_type_id);

create table user_session
(
    session_id    varchar(128)               not null
        primary key,
    staff_id      int                        null,
    login_time    datetime                   null,
    logout_time   datetime                   null,
    ip_address    varchar(61)                null,
    status        enum ('Active', 'Expired') null,
    last_activity datetime                   null,
    constraint user_session_ibfk_1
        foreign key (staff_id) references staff (staff_id)
);

create index staff_id
    on user_session (staff_id);



