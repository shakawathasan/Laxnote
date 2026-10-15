/**
 * LexNote IndexedDB Storage Layer
 * High-performance, offline-first local storage for LLB students
 */

const DB_NAME = 'LexNoteDB';
const DB_VERSION = 1;

let dbInstance = null;

// In-memory fallback if IndexedDB is blocked in sandboxed iframes or private browsing
const memoryFallback = {
  notes: [],
  subjects: [],
  documents: [],
  research: [],
  settings: []
};

// Attempt to load from localStorage as backup cache
try {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('lexnote_storage_backup');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        Object.assign(memoryFallback, parsed);
      }
    }
  }
} catch {
  // localStorage blocked or restricted
}

function persistMemoryFallback() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lexnote_storage_backup', JSON.stringify(memoryFallback));
    }
  } catch {
    // ignore
  }
}

export async function getDB() {
  if (dbInstance) return dbInstance;
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB not supported in this runtime environment');
  }

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Notes Store
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('subjectId', 'subjectId', { unique: false });
          notesStore.createIndex('semester', 'semester', { unique: false });
          notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          notesStore.createIndex('bookmarked', 'bookmarked', { unique: false });
        }

        // 2. Subjects Store
        if (!db.objectStoreNames.contains('subjects')) {
          const subjectsStore = db.createObjectStore('subjects', { keyPath: 'id' });
          subjectsStore.createIndex('semester', 'semester', { unique: false });
        }

        // 3. Documents Store (for uploaded PDFs, OCR records)
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 4. Legal Research Store (FIRAC Case briefs, statutory articles)
        if (!db.objectStoreNames.contains('research')) {
          const resStore = db.createObjectStore('research', { keyPath: 'id' });
          resStore.createIndex('type', 'type', { unique: false });
          resStore.createIndex('verified', 'verified', { unique: false });
        }

        // 5. Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.warn('IndexedDB request error, falling back to in-memory store:', event.target?.error);
        reject(event.target?.error || new Error('IndexedDB open error'));
      };

      request.onblocked = () => {
        console.warn('IndexedDB blocked');
      };
    } catch (e) {
      reject(e);
    }
  });
}

// Generic transaction helpers with resilient fallback
async function executeTransaction(storeName, mode, callback) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target?.error || new Error('Transaction error'));
    });
  } catch (err) {
    console.warn(`IndexedDB unavailable for ${storeName}, using resilient memory/localStorage fallback:`, err?.message);
    const list = memoryFallback[storeName] || [];
    
    // Provide compatible mock store object
    const mockStore = {
      getAll: () => [...list],
      get: (key) => list.find(item => item.id === key || item.key === key) || null,
      put: (item) => {
        const idKey = item.id !== undefined ? 'id' : 'key';
        const idx = list.findIndex(existing => existing[idKey] === item[idKey]);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
        persistMemoryFallback();
        return item;
      },
      delete: (key) => {
        const idx = list.findIndex(item => item.id === key || item.key === key);
        if (idx >= 0) list.splice(idx, 1);
        persistMemoryFallback();
        return true;
      }
    };
    return callback(mockStore);
  }
}

// --- Notes CRUD ---
export async function getNotes() {
  return executeTransaction('notes', 'readonly', (store) => store.getAll());
}

export async function getNote(id) {
  return executeTransaction('notes', 'readonly', (store) => store.get(id));
}

export async function saveNote(note) {
  const noteToSave = {
    ...note,
    id: note.id || 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    updatedAt: new Date().toISOString(),
    createdAt: note.createdAt || new Date().toISOString()
  };
  await executeTransaction('notes', 'readwrite', (store) => store.put(noteToSave));
  return noteToSave;
}

export async function deleteNote(id) {
  return executeTransaction('notes', 'readwrite', (store) => store.delete(id));
}

// --- Subjects CRUD ---
export async function getSubjects() {
  return executeTransaction('subjects', 'readonly', (store) => store.getAll());
}

export async function saveSubject(subject) {
  const subjectToSave = {
    ...subject,
    id: subject.id || 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
    createdAt: subject.createdAt || new Date().toISOString()
  };
  await executeTransaction('subjects', 'readwrite', (store) => store.put(subjectToSave));
  return subjectToSave;
}

export async function deleteSubject(id) {
  return executeTransaction('subjects', 'readwrite', (store) => store.delete(id));
}

// --- Documents CRUD ---
export async function getDocuments() {
  return executeTransaction('documents', 'readonly', (store) => store.getAll());
}

export async function getDocument(id) {
  return executeTransaction('documents', 'readonly', (store) => store.get(id));
}

export async function saveDocument(doc) {
  const docToSave = {
    ...doc,
    id: doc.id || 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    createdAt: doc.createdAt || new Date().toISOString()
  };
  await executeTransaction('documents', 'readwrite', (store) => store.put(docToSave));
  return docToSave;
}

export async function deleteDocument(id) {
  return executeTransaction('documents', 'readwrite', (store) => store.delete(id));
}

// --- Legal Research (FIRAC / Case Briefs) CRUD ---
export async function getResearchItems() {
  return executeTransaction('research', 'readonly', (store) => store.getAll());
}

export async function getResearchItem(id) {
  return executeTransaction('research', 'readonly', (store) => store.get(id));
}

export async function saveResearchItem(item) {
  const itemToSave = {
    ...item,
    id: item.id || 'res_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    updatedAt: new Date().toISOString(),
    createdAt: item.createdAt || new Date().toISOString()
  };
  await executeTransaction('research', 'readwrite', (store) => store.put(itemToSave));
  return itemToSave;
}

export async function deleteResearchItem(id) {
  return executeTransaction('research', 'readwrite', (store) => store.delete(id));
}

// --- Settings Storage ---
export async function getSetting(key, defaultValue = null) {
  try {
    const item = await executeTransaction('settings', 'readonly', (store) => store.get(key));
    return item ? item.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function saveSetting(key, value) {
  return executeTransaction('settings', 'readwrite', (store) => store.put({ key, value }));
}

// --- Seeding Initial LLB Curriculum Data ---
export async function seedInitialDataIfNeeded() {
  const existingSubjects = await getSubjects();
  if (existingSubjects && existingSubjects.length > 0) {
    return; // Already initialized
  }

  // Pre-seed core curriculum subjects requested in prompt:
  // Constitutional Law, Jurisprudence, Contract Law, Tort Law, Muslim Law, Labour Law, Land Law, Banking & Insurance Law
  const defaultSubjects = [
    {
      id: 'sub_const',
      name: 'Constitutional Law',
      nameBn: 'সাংবিধানিক আইন',
      code: 'LAW-101',
      semester: '1st Year / 1st Sem',
      description: 'Fundamental Rights, Judicial Review, Writ Jurisdiction (Art 102), Separation of Powers',
      color: '#23483F'
    },
    {
      id: 'sub_juris',
      name: 'Jurisprudence',
      nameBn: 'আইনশাস্ত্র ও ন্যায়তত্ত্ব',
      code: 'LAW-102',
      semester: '1st Year / 1st Sem',
      description: 'Legal Theories, Positivism (Austin/Hart), Natural Law, Sources of Law, Custom, Precedent',
      color: '#4A6258'
    },
    {
      id: 'sub_contract',
      name: 'Contract Law',
      nameBn: 'চুক্তি আইন',
      code: 'LAW-103',
      semester: '1st Year / 2nd Sem',
      description: 'Contract Act 1872: Offer, Acceptance, Consideration, Void vs Voidable, Frustration, Breach',
      color: '#345548'
    },
    {
      id: 'sub_tort',
      name: 'Tort Law',
      nameBn: 'টর্ট আইন',
      code: 'LAW-104',
      semester: '1st Year / 2nd Sem',
      description: 'Civil Wrongs: Negligence (Duty of Care), Defamation, Nuisance, Strict & Absolute Liability',
      color: '#3F6153'
    },
    {
      id: 'sub_muslim',
      name: 'Muslim Law',
      nameBn: 'মুসলিম ব্যক্তিগত আইন',
      code: 'LAW-201',
      semester: '2nd Year / 1st Sem',
      description: 'Marriage (Nikah), Dower (Mahr), Divorce (Talaq), Gift (Hiba), Waqf, Succession & Inheritance',
      color: '#2A5243'
    },
    {
      id: 'sub_labour',
      name: 'Labour Law',
      nameBn: 'শ্রম আইন',
      code: 'LAW-202',
      semester: '2nd Year / 2nd Sem',
      description: 'Bangladesh Labour Act 2006: Worker Classification, Retrenchment, Gratuity, Trade Unions',
      color: '#366050'
    },
    {
      id: 'sub_land',
      name: 'Land Law',
      nameBn: 'ভূমি ও সম্পত্তি আইন',
      code: 'LAW-301',
      semester: '3rd Year / 1st Sem',
      description: 'State Acquisition & Tenancy Act 1950, Transfer of Property Act 1882, Mutation & Khatian',
      color: '#4B6B5D'
    },
    {
      id: 'sub_bank',
      name: 'Banking and Insurance Law',
      nameBn: 'ব্যাংকিং ও বীমা আইন',
      code: 'LAW-302',
      semester: '3rd Year / 2nd Sem',
      description: 'Negotiable Instruments Act 1881 (Cheque Dishonor Sec 138), Bank Companies Act 1991, Insurance Act 2010',
      color: '#2F5747'
    }
  ];

  for (const sub of defaultSubjects) {
    await saveSubject(sub);
  }

  // Pre-seed sample realistic law lecture notes (bilingual, English & Bangla)
  const sampleNotes = [
    {
      id: 'note_const_01',
      title: 'Constitutional Law: Article 102 Writ Jurisdiction & Judicial Review',
      semester: '1st Year / 1st Sem',
      subjectId: 'sub_const',
      chapter: 'Part III & Part VI',
      topic: 'High Court Division Writ Powers',
      lectureNo: 'Lecture 04',
      lectureDate: '2026-03-12',
      language: 'bilingual',
      sourceType: 'voice',
      audioDuration: '24m 10s',
      bookmarked: true,
      tags: ['Article 102', 'Writ', 'Habeas Corpus', 'Mandamus', 'Quo Warranto', 'Certiorari', 'Judicial Review'],
      rawTranscript: 'Today sir discussed Article 102 of the Bangladesh Constitution. High Court Division has extraordinary writ jurisdiction. When fundamental rights under Part 3 are violated any aggrieved person can move the court under Article 102 clause 1. Clause 2 gives 5 traditional prerogative writs: Habeas Corpus, Mandamus, Prohibition, Quo Warranto, Certiorari. Sir emphasized locus standi principle in Bangladesh evolved through Kudrat-e-Elahi Panjheer v. Bangladesh and Dr. Mohiuddin Farooque case (FAP 20) which recognized public interest litigation PIL. In Habeas corpus the detention must be illegal or without lawful authority.',
      structuredNote: `### 1. Executive Summary & Purpose
Article 102 of the Constitution of the People's Republic of Bangladesh empowers the High Court Division (HCD) with extraordinary writ jurisdiction to enforce Fundamental Rights (Part III) and supervise statutory and public authorities.

### 2. Statutory & Constitutional Provisions
- **Article 102(1)**: Enforcement of any Fundamental Rights conferred by Part III. Locus standi is available to "any person aggrieved".
- **Article 102(2)(a)(i)**: *Writ of Prohibition* & *Writ of Mandamus* — directing an authority to refrain from doing what is not permitted, or to do what is required by law.
- **Article 102(2)(a)(ii)**: *Writ of Certiorari* — declaring an act or proceeding done without lawful authority and of no legal effect.
- **Article 102(2)(b)(i)**: *Writ of Habeas Corpus* — directing that a person in custody be brought before the court to satisfy itself that they are not being held without lawful authority.
- **Article 102(2)(b)(ii)**: *Writ of Quo Warranto* — inquiring by what authority a person holds or purports to hold a public office.

### 3. Key Judicial Precedents & Ratio Decidendi
- ***Dr. Mohiuddin Farooque v. Bangladesh (FAP 20 Case, 49 DLR (AD) 1)***:
  - **Ratio**: Broadened the doctrine of "aggrieved person" to incorporate Public Interest Litigation (PIL). Anyone representing a public wrong with bona fide interest has locus standi.
- ***Kudrat-e-Elahi Panjheer v. Bangladesh (44 DLR (AD) 319)***:
  - **Ratio**: Validated constitutional supremacy and the boundary between local government and executive discretion.

### 4. Classroom Lecture Key Points (বাংলা ও ইংরেজি সারসংক্ষেপ)
- রিট শুধুমাত্র রাষ্ট্রীয় বা সরকারি কর্তৃপক্ষের বিরুদ্ধে প্রযোজ্য (Does not lie against purely private bodies unless discharging public duty).
- যদি কোনো পর্যাপ্ত বিকল্প প্রতিকার (Adequate alternative remedy) বিদ্যমান থাকে, তবে রিট সাধারণত গ্রহণযোগ্য নয়, যদি না মৌলিক অধিকার লঙ্ঘিত হয়।
- হেবিয়াস কর্পাস (Habeas Corpus) বন্দি ব্যক্তির পক্ষে যে কেউ দায়ের করতে পারে; এখানে কড়া লোকাস স্ট্যান্ডির দরকার নেই।`,
      summary: 'Article 102 gives the High Court Division 5 prerogative writs (Habeas Corpus, Mandamus, Certiorari, Prohibition, Quo Warranto) to protect Part III Fundamental Rights and check unlawful executive action. Locus standi was expanded for Public Interest Litigation via the landmark Dr. Mohiuddin Farooque case.',
      comments: 'Review FAP 20 judgment pages 15-28 before the midterm tutorial.'
    },
    {
      id: 'note_contract_01',
      title: 'Contract Act 1872: Essentials of a Valid Contract (Section 10)',
      semester: '1st Year / 2nd Sem',
      subjectId: 'sub_contract',
      chapter: 'Chapter II: Contracts, Voidable Contracts & Void Agreements',
      topic: 'Offer, Acceptance, Consideration & Capacity',
      lectureNo: 'Lecture 02',
      lectureDate: '2026-03-18',
      language: 'bilingual',
      sourceType: 'typed',
      bookmarked: true,
      tags: ['Section 10', 'Contract Act 1872', 'Offer', 'Acceptance', 'Consideration', 'Balfour v Balfour'],
      rawTranscript: 'Lecture on Section 10 of Contract Act 1872. All agreements are contracts if they are made by free consent of parties competent to contract for a lawful consideration and with a lawful object and not hereby expressly declared to be void. Sec 2h says contract is an agreement enforceable by law. Social agreements have no intention to create legal relations like Balfour v Balfour. In Mohori Bibee v Dharmodas Ghose a contract with a minor is void ab initio.',
      structuredNote: `### 1. Executive Summary & Purpose
Section 10 of the Contract Act 1872 establishes the statutory benchmark distinguishing a mere informal agreement (Section 2(e)) from an enforceable legal contract (Section 2(h)).

### 2. Statutory Definitions (Contract Act 1872)
- **Section 2(h)**: *"An agreement enforceable by law is a contract."*
- **Section 10 Criteria**:
  1. **Free Consent (Sections 13–22)**: Free from Coercion (s. 15), Undue Influence (s. 16), Fraud (s. 17), Misrepresentation (s. 18), and Bilateral Mistake of Fact (s. 20).
  2. **Competency of Parties (Section 11)**: Age of majority (18+), sound mind (s. 12), not disqualified by law.
  3. **Lawful Consideration (Section 2(d), 23)**: Quid pro quo; consideration must not be unlawful, fraudulent, or injurious.
  4. **Lawful Object (Section 23)**: Not opposed to public policy or prohibited by statute.
  5. **Not Expressly Declared Void**: Sections 24 to 30 (e.g. Agreement in restraint of trade, marriage, legal proceedings, wager).

### 3. Landmark Case Precedents
- ***Balfour v. Balfour [1919] 2 KB 571***:
  - **Fact**: Husband promised monthly maintenance of £30 while stationed in Ceylon.
  - **Ratio**: Domestic and social arrangements do not demonstrate an intention to create legal relations (*animus contrahendi*).
- ***Mohori Bibee v. Dharmodas Ghose (1903) 30 IA 114***:
  - **Ratio**: A contract entered into by a minor is *void ab initio* (সম্পূর্ণভাবে শুরু থেকেই বাতিল), not merely voidable.

### 4. Classroom Observations & Bangla Terminology
- **চুক্তি (Contract)** = সম্মতি (Agreement) + আইনগত বলবৎযোগ্যতা (Enforceability by Law).
- অপ্রাপ্তবয়স্কের সাথে চুক্তি শুরু থেকেই মূল্যহীন (Void ab initio); কোনো ঋণ পরিশোধ বা বন্ধক বলবৎ করা যায় না।`,
      summary: 'Under Section 10 of Contract Act 1872, an enforceable contract requires free consent, capacity of parties (minors void ab initio per Mohori Bibee), lawful consideration, lawful object, and intention to create legal relations (Balfour v Balfour).',
      comments: 'Prepare distinction table between Void (বাতিল) and Voidable (বাতিলযোগ্য) agreements.'
    },
    {
      id: 'note_tort_01',
      title: 'Law of Tort: Negligence & Duty of Care (Donoghue v. Stevenson)',
      semester: '1st Year / 2nd Sem',
      subjectId: 'sub_tort',
      chapter: 'Specific Torts: Negligence',
      topic: 'The Neighbour Principle & Duty of Care',
      lectureNo: 'Lecture 06',
      lectureDate: '2026-03-24',
      language: 'en',
      sourceType: 'voice',
      audioDuration: '18m 45s',
      bookmarked: false,
      tags: ['Negligence', 'Tort', 'Duty of Care', 'Donoghue v Stevenson', 'Neighbour Principle', 'Breach'],
      rawTranscript: 'Class on Negligence. Negligence in tort law is the breach of a legal duty to take care which results in damage. Three elements must be proved: 1 legal duty of care, 2 breach of that duty by defendant, 3 consequential damage to plaintiff. Landmark case Donoghue v Stevenson 1932 ginger beer bottle with decomposed snail inside. Lord Atkin laid down the famous neighbour principle. You must take reasonable care to avoid acts or omissions which you can reasonably foresee would be likely to injure your neighbour.',
      structuredNote: `### 1. Executive Summary & Purpose
Negligence in the Law of Tort is an independent tort actionable upon proof of three mandatory elements: legal duty of care, breach of standard of care, and consequential harm (damage not too remote).

### 2. Tripartite Elements of Negligence
1. **Existence of a Legal Duty of Care**: The defendant must owe a recognized duty to the plaintiff.
2. **Breach of Duty**: Failure to reach the standard of a reasonable person (*the prudent man test* in *Blyth v. Birmingham Waterworks*).
3. **Causation & Damage**: Causation in fact ("but-for" test) + Causation in law (Damage must not be too remote under *The Wagon Mound No. 1*).

### 3. Landmark Case Precedents
- ***Donoghue v. Stevenson [1932] AC 562 (House of Lords)***:
  - **Facts**: A friend bought Mrs. Donoghue a bottle of ginger beer manufactured by Stevenson. The opaque bottle contained remnants of a decomposed snail. Donoghue suffered severe gastroenteritis and nervous shock.
  - **Legal Issue**: Did the manufacturer owe a duty of care to the ultimate consumer in the absence of any contractual privity?
  - **Ratio Decidendi (Lord Atkin)**: Yes. *"You must take reasonable care to avoid acts or omissions which you can reasonably foresee would be likely to injure your neighbour. Who, then, in law, is my neighbour? The answer seems to be — persons who are so closely and directly affected by my act that I ought reasonably to have them in contemplation."*

### 4. Classroom Notes
- Privity of contract does not defeat tortious liability in negligence.
- Manufacturers owe a direct duty of care to ultimate consumers when products leave without reasonable possibility of intermediate examination.`,
      summary: 'Tort of negligence requires duty of care, breach, and damage. Donoghue v Stevenson established modern product liability and Lord Atkin\'s "Neighbour Principle" based on reasonable foreseeability without privity of contract.',
      comments: 'Compare Lord Atkin neighbour test with modern Caparo Industries v Dickman three-stage test.'
    }
  ];

  for (const n of sampleNotes) {
    await saveNote(n);
  }

  // Pre-seed sample Legal Research items (FIRAC Briefs)
  const sampleResearch = [
    {
      id: 'res_firac_01',
      type: 'case',
      title: 'Dr. Mohiuddin Farooque v. Bangladesh (FAP 20 Case)',
      citation: '49 DLR (AD) 1 (1997)',
      court: 'Supreme Court of Bangladesh, Appellate Division',
      year: '1997',
      actName: 'Constitution of Bangladesh',
      sectionNumber: 'Article 102',
      verified: true,
      facts: 'The Bangladesh Environmental Lawyers Association (BELA), represented by Dr. Mohiuddin Farooque, filed a writ petition challenging the Flood Action Plan (FAP 20) project in Tangail, alleging severe environmental degradation, displacement of local residents without compensation, and violation of the constitutional right to life (Art 31 & 32). The High Court Division summarily dismissed the writ holding BELA was not an "aggrieved person" under Article 102.',
      issues: 'Whether an environmental organization representing the public interest qualifies as an "aggrieved person" under Article 102(1) of the Constitution of Bangladesh to maintain a writ petition without showing personal proprietary or pecuniary injury?',
      decision: 'Appellate Division allowed the appeal, reversed the HCD order, and held that BELA had standing. The petition was remitted for hearing on merits.',
      reasoning: 'Chief Justice A.T.M. Afzal and Justice Mustafa Kamal held that constitutional interpretation must be dynamic and purposive. An "aggrieved person" in a developing nation cannot be confined strictly to narrow Anglo-Saxon individualistic rights. When a public wrong or injury threatens the life, ecology, or fundamental rights of numerous citizens who cannot easily approach the court, an organization dedicated to that cause has genuine legal standing.',
      principle: 'Public Interest Litigation (PIL) is recognized under Article 102. "Aggrieved person" includes bona fide civic bodies advocating collective public rights.',
      tags: ['Constitutional Law', 'PIL', 'Article 102', 'Locus Standi', 'Right to Life', 'Environmental Law']
    },
    {
      id: 'res_firac_02',
      type: 'case',
      title: 'Carlill v. Carbolic Smoke Ball Company',
      citation: '[1893] 1 QB 256',
      court: 'Court of Appeal of England and Wales',
      year: '1893',
      actName: 'Contract Law / Contract Act 1872',
      sectionNumber: 'Section 8 (Performance of conditions of proposal)',
      verified: true,
      facts: 'Carbolic Smoke Ball Co. advertised that it would pay £100 reward to anyone who contracted influenza after using its carbolic smoke ball three times daily for two weeks. It claimed £1,000 had been deposited with Alliance Bank to show sincerity. Mrs. Carlill used the ball as directed but still contracted flu. The company refused payment claiming the ad was mere marketing puff and there was no contract.',
      issues: '1. Can an advertisement directed to the general world constitute a binding unilateral legal offer?\n2. Did Mrs. Carlill need to communicate acceptance to form a contract?',
      decision: 'Court ruled unanimously in favour of Mrs. Carlill; the company was legally bound to pay the £100.',
      reasoning: 'Lindley LJ held that the deposit of £1,000 at the bank proved serious legal intent, negating the "mere puff" defense. An offer made to the whole world can be accepted by any individual who performs the specified condition (unilateral contract). Notice of acceptance is impliedly waived by the nature of the transaction; performing the condition is sufficient acceptance.',
      principle: 'Unilateral offer to the world at large is valid. Performance of conditions without prior notification constitutes sufficient acceptance (equivalent to Section 8, Contract Act 1872).',
      tags: ['Contract Act', 'Offer to World', 'Unilateral Contract', 'Acceptance by Performance']
    }
  ];

  for (const r of sampleResearch) {
    await saveResearchItem(r);
  }
}

// Full JSON Backup Export & Import
export async function exportAllData() {
  const [notes, subjects, documents, research] = await Promise.all([
    getNotes(),
    getSubjects(),
    getDocuments(),
    getResearchItems()
  ]);

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    appName: 'LexNote — My AI Law Notebook',
    data: {
      notes,
      subjects,
      documents,
      research
    }
  };
}

export async function importAllData(importedJson) {
  if (!importedJson || !importedJson.data) {
    throw new Error('Invalid LexNote backup file format');
  }

  const { notes = [], subjects = [], documents = [], research = [] } = importedJson.data;

  // Insert or overwrite items
  for (const s of subjects) {
    await saveSubject(s);
  }
  for (const n of notes) {
    await saveNote(n);
  }
  for (const d of documents) {
    await saveDocument(d);
  }
  for (const r of research) {
    await saveResearchItem(r);
  }

  return {
    importedNotes: notes.length,
    importedSubjects: subjects.length,
    importedDocuments: documents.length,
    importedResearch: research.length
  };
}
