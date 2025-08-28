# SQLModel Deprecation Warning Fix Plan

## Root Cause Analysis

The SQLModel deprecation warning occurs because we're using the deprecated `session.execute()` method instead of the recommended `session.exec()` method in `/app/app/crud/crud_user.py:42` (specifically in `get_by_username`).

## Research Findings

1. **SQLModel Version**: Project uses SQLModel >=0.0.16 (sufficient for proper async support)
2. **Session Configuration**: Properly configured with `expire_on_commit=False`
3. **Import Consistency**: All files correctly use `from sqlmodel.ext.asyncio.session import AsyncSession`
4. **Working Pattern**: The `base.py` already has the correct pattern using `session.exec()` with `one_or_none()`

## Current Warning Output

```
/app/app/crud/crud_user.py:42: DeprecationWarning: 
        🚨 You probably want to use `session.exec()` instead of `session.execute()`.

        This is the original SQLAlchemy `session.execute()` method that returns objects
        of type `Row`, and that you have to call `scalars()` to get the model objects.

        For example:

        ```Python
        heroes = await session.execute(select(Hero)).scalars().all()
        ```

        instead you could use `exec()`:

        ```Python
        heroes = await session.exec(select(Hero)).all()
        ```
```

## Specific Issue & Solution

### Current Deprecated Pattern
```python
# In crud_user.py line 42 (causing warning)
result = await self.session.execute(statement)
user = result.scalar_one_or_none()
```

### Correct Modern Pattern 
(as seen in working `base.py`)
```python  
# Convert to this pattern
result = await self.session.exec(statement)
user = result.one_or_none()
```

## Implementation Plan

### Step 1: Fix Primary Methods

Target three specific methods in `crud_user.py` that cause deprecation warnings:

1. **`get_by_username()` (line 42)** - Primary source of current warning
2. **`get_by_email()` (line 48)** - Same pattern, same issue  
3. **`get_all_users()` (line 57)** - Different pattern: `scalars().all()` → `all()`

### Step 2: Conversion Mappings

| Deprecated Pattern | Modern Pattern |
|-------------------|----------------|
| `session.execute(statement)` | `session.exec(statement)` |
| `result.scalar_one_or_none()` | `result.one_or_none()` |
| `result.scalars().all()` | `result.all()` |

### Step 3: Detailed Changes Required

#### Change 1: get_by_username method
```python
# FROM (line 40-44):
async def get_by_username(self, username: str) -> Optional[User]:
    statement = select(User).where(User.username == username)
    result = await self.session.execute(statement)  # DEPRECATED
    user = result.scalar_one_or_none()              # DEPRECATED
    return user

# TO:
async def get_by_username(self, username: str) -> Optional[User]:
    statement = select(User).where(User.username == username)
    result = await self.session.exec(statement)     # MODERN
    user = result.one_or_none()                     # MODERN
    return user
```

#### Change 2: get_by_email method
```python
# FROM (line 46-50):
async def get_by_email(self, email: str) -> Optional[User]:
    statement = select(User).where(User.email == email)
    result = await self.session.execute(statement)  # DEPRECATED
    user = result.scalar_one_or_none()              # DEPRECATED
    return user

# TO:
async def get_by_email(self, email: str) -> Optional[User]:
    statement = select(User).where(User.email == email)
    result = await self.session.exec(statement)     # MODERN
    user = result.one_or_none()                     # MODERN
    return user
```

#### Change 3: get_all_users method  
```python
# FROM (line 55-59):
async def get_all_users(self, skip: int = 0, limit: int = 100) -> List[User]:
    statement = select(User).offset(skip).limit(limit)
    result = await self.session.execute(statement)  # DEPRECATED
    users = result.scalars().all()                  # DEPRECATED
    return list(users)

# TO:
async def get_all_users(self, skip: int = 0, limit: int = 100) -> List[User]:
    statement = select(User).offset(skip).limit(limit)
    result = await self.session.exec(statement)     # MODERN  
    users = result.all()                            # MODERN
    return list(users)
```

### Step 4: Testing Strategy

After each conversion:

1. **Run the specific test**: `make test-specific TEST=tests/endpoints/test_auth.py::test_login_valid_credentials`
2. **Verify the deprecation warning is eliminated**
3. **Ensure authentication still works correctly** 
4. **If any issues arise, analyze and adjust based on base.py working pattern**

### Step 5: Expected Outcome

- ✅ Eliminate the SQLModel deprecation warning from test output
- ✅ Maintain full functionality of authentication system  
- ✅ Reduce deprecation warnings from 2 to 1 (only botocore remains)

## Risk Mitigation

- **Work incrementally**: Change one method at a time
- **Test immediately**: Run test after each change
- **Use proven pattern**: Follow the working pattern from `base.py` as reference
- **Rollback if needed**: If conversion fails, analyze exact difference vs. base.py implementation

## Reference: Working Pattern in base.py

```python
# This pattern in base.py already works correctly (lines 108-110):
async def get_by(self, field_name: str, val: Union[str, int], strict: bool = False) -> Union[ModelType, None]:
    statement = select(self.model).where(getattr(self.model, field_name) == val)
    results = await self.session.exec(statement=statement)  # ✅ Uses exec()
    entry = results.one_or_none()                          # ✅ Uses one_or_none()
    return entry
```

## Key Research Insights

1. **SQLModel >=0.0.16** has proper async support and type annotations
2. **Consistent imports** are crucial - all files use `from sqlmodel.ext.asyncio.session import AsyncSession`
3. **session.exec()** returns objects that can directly call `.one_or_none()` and `.all()`
4. **session.execute()** returns Row objects that need `.scalar_one_or_none()` or `.scalars().all()`
5. **Performance difference** between patterns is negligible
6. **The warning is actionable** and the conversion should work based on existing base.py pattern

## Final Test Command

```bash
make test-specific TEST=tests/endpoints/test_auth.py::test_login_valid_credentials
```

Expected result after fixes: Only 1 deprecation warning (botocore) instead of 2.