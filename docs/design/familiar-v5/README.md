# Familiar DSH Work v5 design baseline

Frozen from the product owner's interactive PRD and latest four generated designs on 2026-09-05. [requirements.json](requirements.json) is the behavior fact source for this milestone: R01-R18, eight scenarios and phases A-E. The implementation ledger links every requirement to a task and fresh evidence.

| Image | Scope |
| --- | --- |
| [New conversation](01-new-conversation.png) | Two columns, original composer, native model/mode/permissions |
| [Permission](02-permission.png) | Inline original authorization, allow once or refuse |
| [File review](03-file-review.png) | Optional right preview, original-composer revision, independent save/adoption |
| [Version comparison](04-version-comparison.png) | Real history, compare, restore-as-new, selected-version actions |

Images define product composition, not existing capability or pixel-perfect upstream screenshots. Prefer the PRD when a mock image omits a state. Keep sidebar sizing and typography consistent across images instead of copying generation inconsistencies.

Visual tokens: white content; sidebar `#f6f7f9`; text `#242a35`; secondary `#626b7a`; border `#e1e5ec`; accent `#365eca`; selection `#e8efff`. System sans-serif/PingFang SC; restrained 6px button and 10px composer radii. Preserve original native controls and a single composer. Detail closes by default. At narrow widths preview becomes a returnable single panel without losing drafts.

Missing-model, empty search, generation, denied permission, failed revision and runtime recovery states are required despite not having separate concept images. Version/adoption controls belong to phase C; native Save As and Office are later capabilities.
